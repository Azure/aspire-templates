import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { RealtimeConnection } from './lib/realtime';
import type { ConnectionState } from './lib/realtime';
import { formatTime, mergeMessage } from './lib/types';
import type { Brand, ChatMessage, ConversationDetail, ConversationSummary, ServerEvent } from './lib/types';

type LocalMessage = ChatMessage & { delivery?: 'sending' | 'failed' };

interface StoredSession {
  conversationId: string;
  customerKey: string;
}

const SESSION_KEY = 'support-session';
const DELIVERY_TIMEOUT_MS = 10000;
const topics = ['Billing & payments', 'Power outage', 'Start, stop or move service', 'Energy plans', 'Something else'];

function loadSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

async function customerFetch(session: StoredSession, path: string, init?: RequestInit): Promise<Response> {
  return fetch(`/api/conversations/${session.conversationId}${path}`, {
    ...init,
    headers: { 'X-Customer-Key': session.customerKey, ...init?.headers },
  });
}

export function SupportWidget({ brand }: { brand: Brand }) {
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState<StoredSession | null>(loadSession);
  const [conversation, setConversation] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [agentTyping, setAgentTyping] = useState(false);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const realtime = useRef<RealtimeConnection<ServerEvent> | null>(null);
  const openRef = useRef(open);
  const deliveryTimers = useRef(new Map<string, number>());

  useEffect(() => {
    openRef.current = open;
    if (open) setUnread(0);
  }, [open]);

  const applyDetail = useCallback((detail: ConversationDetail) => {
    setConversation(detail.conversation);
    setMessages((current) => {
      const pending = current.filter((m) => m.delivery && !detail.messages.some((d) => d.clientMessageId === m.clientMessageId));
      return [...detail.messages, ...pending];
    });
  }, []);

  const refresh = useCallback(
    async (current: StoredSession) => {
      const response = await customerFetch(current, '');
      if (response.status === 404) {
        sessionStorage.removeItem(SESSION_KEY);
        setSession(null);
        setConversation(null);
        setMessages([]);
        return;
      }
      if (response.ok) applyDetail((await response.json()) as ConversationDetail);
    },
    [applyDetail],
  );

  const handleEvent = useCallback((event: ServerEvent) => {
    switch (event.type) {
      case 'conversation':
        setConversation(event.conversation);
        break;
      case 'message': {
        const { message } = event;
        if (message.clientMessageId) {
          window.clearTimeout(deliveryTimers.current.get(message.clientMessageId));
          deliveryTimers.current.delete(message.clientMessageId);
        }
        setMessages((current) => mergeMessage(current, message));
        if (message.sender === 'agent') {
          setAgentTyping(false);
          if (!openRef.current) setUnread((n) => n + 1);
        }
        break;
      }
      case 'typing':
        if (event.sender === 'agent') setAgentTyping(event.isTyping);
        break;
    }
  }, []);

  const isLive = session !== null && conversation !== null && conversation.status !== 'closed';

  // Load an existing conversation after a page refresh.
  useEffect(() => {
    if (session && !conversation) void refresh(session).catch(() => setError('We could not reach support. Please try again.'));
  }, [session, conversation, refresh]);

  // Keep a Web PubSub connection open while the conversation is live.
  useEffect(() => {
    if (!session || !isLive) return;

    const connection = new RealtimeConnection<ServerEvent>({
      negotiate: async () => {
        const response = await customerFetch(session, '/negotiate', { method: 'POST' });
        if (!response.ok) throw new Error(`Negotiate failed (${response.status})`);
        return ((await response.json()) as { url: string }).url;
      },
      onMessage: handleEvent,
      onStateChange: setConnection,
      // Catch up on anything sent while we were disconnected.
      onConnected: () => void refresh(session).catch(() => undefined),
    });
    realtime.current = connection;
    connection.start();

    return () => {
      connection.stop();
      realtime.current = null;
    };
  }, [session, isLive, handleEvent, refresh]);

  const startConversation = async (customerName: string, topic: string, message: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerName, topic, message }),
      });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as { conversation: ConversationDetail; customerKey: string };
      const next = { conversationId: result.conversation.conversation.id, customerKey: result.customerKey };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      applyDetail(result.conversation);
      setSession(next);
    } catch {
      setError('We could not start a chat right now. Please try again in a moment.');
    } finally {
      setLoading(false);
    }
  };

  const deliver = (message: LocalMessage) => {
    const clientMessageId = message.clientMessageId!;
    const sent = realtime.current?.sendEvent('message', { conversationId: message.conversationId, text: message.text, clientMessageId });
    const markFailed = () =>
      setMessages((current) => current.map((m) => (m.clientMessageId === clientMessageId && m.delivery ? { ...m, delivery: 'failed' } : m)));

    if (!sent) {
      markFailed();
      return;
    }
    deliveryTimers.current.set(clientMessageId, window.setTimeout(markFailed, DELIVERY_TIMEOUT_MS));
  };

  const sendMessage = (text: string) => {
    if (!conversation) return;
    const clientMessageId = crypto.randomUUID();
    const message: LocalMessage = {
      id: `local-${clientMessageId}`,
      conversationId: conversation.id,
      sender: 'customer',
      senderName: conversation.customerName,
      text,
      sentAt: new Date().toISOString(),
      clientMessageId,
      delivery: 'sending',
    };
    setMessages((current) => [...current, message]);
    deliver(message);
  };

  const retry = (message: LocalMessage) => {
    setMessages((current) => current.map((m) => (m.id === message.id ? { ...m, delivery: 'sending' } : m)));
    deliver(message);
  };

  const endChat = async () => {
    if (!session) return;
    const response = await customerFetch(session, '/close', { method: 'POST' }).catch(() => null);
    if (response?.ok) applyDetail((await response.json()) as ConversationDetail);
    else setError('We could not end the chat. Please try again.');
  };

  const startOver = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setConversation(null);
    setMessages([]);
    setError(null);
  };

  return (
    <div className="support">
      {open && (
        <section className="support-panel" role="dialog" aria-label={`${brand.supportTeamName} chat`}>
          <header className="support-header">
            <div className="support-avatar" aria-hidden="true">
              {conversation?.agentName?.[0] ?? brand.name[0]}
            </div>
            <div className="support-heading">
              <strong>{conversation?.agentName ?? brand.supportTeamName}</strong>
              <StatusLine conversation={conversation} connection={connection} />
            </div>
            {isLive && (
              <button className="support-end" type="button" onClick={() => void endChat()}>
                End chat
              </button>
            )}
            <button className="icon-button" type="button" aria-label="Minimize chat" onClick={() => setOpen(false)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
          </header>

          {error && (
            <div className="support-alert" role="alert">
              {error}
              <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
            </div>
          )}

          {conversation ? (
            <Conversation
              conversation={conversation}
              messages={messages}
              agentTyping={agentTyping}
              connection={connection}
              onSend={sendMessage}
              onRetry={retry}
              onTyping={(isTyping) => realtime.current?.sendEvent('typing', { conversationId: conversation.id, isTyping })}
              onStartOver={startOver}
            />
          ) : session ? (
            <div className="support-body support-center"><span className="spinner" /> Loading your conversation…</div>
          ) : (
            <StartForm brand={brand} loading={loading} onStart={startConversation} />
          )}
        </section>
      )}

      <button
        type="button"
        className={`support-launcher${open ? ' is-open' : ''}`}
        aria-label={open ? 'Close support chat' : 'Chat with customer support'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? (
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z" />
            <path d="M8.5 8.5h7M8.5 11.5h4.5" />
          </svg>
        )}
        {unread > 0 && !open && <span className="support-badge">{unread}</span>}
      </button>
    </div>
  );
}

function StatusLine({ conversation, connection }: { conversation: ConversationSummary | null; connection: ConnectionState }) {
  if (conversation && conversation.status !== 'closed' && connection !== 'connected') {
    const label = connection === 'offline' ? 'Offline — retrying' : connection === 'reconnecting' ? 'Reconnecting…' : 'Connecting…';
    return <span className={`status-line ${connection === 'offline' ? 'is-error' : 'is-warning'}`}>{label}</span>;
  }
  if (!conversation) return <span className="status-line">Typically replies in a few minutes</span>;
  if (conversation.status === 'waiting') return <span className="status-line is-warning">Waiting for an agent</span>;
  if (conversation.status === 'active') return <span className="status-line is-online">Online now</span>;
  return <span className="status-line">Chat ended</span>;
}

function StartForm({ brand, loading, onStart }: { brand: Brand; loading: boolean; onStart: (name: string, topic: string, message: string) => void }) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState(topics[0]);
  const [message, setMessage] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onStart(name.trim(), topic, message.trim());
  };

  return (
    <form className="support-body support-form" onSubmit={submit}>
      <div className="support-intro">
        <h2>Hi there 👋</h2>
        <p>Chat with the {brand.supportTeamName} team about your account, an outage or moving home.</p>
      </div>
      <label>
        Your name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="name" required autoFocus />
      </label>
      <label>
        What can we help with?
        <select value={topic} onChange={(e) => setTopic(e.target.value)}>
          {topics.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </label>
      <label>
        Message <span className="optional">(optional)</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} placeholder="Tell us a little more…" />
      </label>
      <button className="button button-primary" type="submit" disabled={loading || !name.trim()}>
        {loading ? <><span className="spinner" /> Connecting…</> : 'Start chat'}
      </button>
      <p className="support-fineprint">This is a demo. Please don't share personal or account details.</p>
    </form>
  );
}

interface ConversationProps {
  conversation: ConversationSummary;
  messages: LocalMessage[];
  agentTyping: boolean;
  connection: ConnectionState;
  onSend: (text: string) => void;
  onRetry: (message: LocalMessage) => void;
  onTyping: (isTyping: boolean) => void;
  onStartOver: () => void;
}

function Conversation({ conversation, messages, agentTyping, connection, onSend, onRetry, onTyping, onStartOver }: ConversationProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const typingTimer = useRef<number | undefined>(undefined);
  const typingSent = useRef(false);
  const closed = conversation.status === 'closed';
  const canSend = !closed && connection === 'connected';

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, agentTyping]);

  const stopTyping = () => {
    window.clearTimeout(typingTimer.current);
    if (typingSent.current) {
      typingSent.current = false;
      onTyping(false);
    }
  };

  const changeDraft = (value: string) => {
    setDraft(value);
    if (!typingSent.current && value) {
      typingSent.current = true;
      onTyping(true);
    }
    window.clearTimeout(typingTimer.current);
    typingTimer.current = window.setTimeout(stopTyping, 2500);
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !canSend) return;
    onSend(text);
    setDraft('');
    stopTyping();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <>
      <ol className="support-body transcript" ref={listRef} aria-live="polite">
        {conversation.status === 'waiting' && (
          <li className="queue-card">
            <span className="pulse" aria-hidden="true" />
            <div>
              <strong>You're in the queue</strong>
              <p>An agent will join shortly. Keep this window open — you can keep typing in the meantime.</p>
            </div>
          </li>
        )}
        {messages.map((message) => (
          <li key={message.id} className={`bubble-row from-${message.sender}`}>
            {message.sender === 'system' ? (
              <span className="system-note">{message.text}</span>
            ) : (
              <div className={`bubble${message.delivery === 'failed' ? ' is-failed' : ''}`}>
                <p>{message.text}</p>
                <span className="bubble-meta">
                  {message.delivery === 'sending' && 'Sending…'}
                  {message.delivery === 'failed' && (
                    <button type="button" className="link-button" onClick={() => onRetry(message)}>
                      Not delivered · Retry
                    </button>
                  )}
                  {!message.delivery && formatTime(message.sentAt)}
                </span>
              </div>
            )}
          </li>
        ))}
        {agentTyping && (
          <li className="bubble-row from-agent">
            <div className="bubble typing" aria-label={`${conversation.agentName ?? 'Agent'} is typing`}>
              <span /><span /><span />
            </div>
          </li>
        )}
      </ol>
      {closed ? (
        <div className="support-footer support-closed">
          <p>This chat has ended. Thanks for contacting us!</p>
          <button type="button" className="button button-primary" onClick={onStartOver}>Start a new chat</button>
        </div>
      ) : (
        <form className="support-footer composer" onSubmit={submit}>
          <textarea
            value={draft}
            onChange={(e) => changeDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={canSend ? 'Type your message…' : 'Waiting for connection…'}
            aria-label="Message"
            rows={1}
            maxLength={2000}
          />
          <button type="submit" className="send-button" disabled={!canSend || !draft.trim()} aria-label="Send message">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z" /></svg>
          </button>
        </form>
      )}
    </>
  );
}
