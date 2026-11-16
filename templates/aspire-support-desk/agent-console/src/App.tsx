import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { RealtimeConnection } from './lib/realtime';
import type { ConnectionState } from './lib/realtime';
import { defaultBrand, fetchBrand, formatTime, mergeMessage } from './lib/types';
import type { Brand, ChatMessage, ConversationDetail, ConversationSummary, ServerEvent } from './lib/types';

type LocalMessage = ChatMessage & { delivery?: 'sending' | 'failed' };

interface Agent {
  id: string;
  name: string;
}

const AGENT_ID_KEY = 'support-agent-id';
const AGENT_NAME_KEY = 'support-agent-name';
const DELIVERY_TIMEOUT_MS = 10000;

// Each browser tab is its own agent so you can demo several agents side by side.
function loadAgent(): Agent | null {
  const name = localStorage.getItem(AGENT_NAME_KEY);
  if (!name) return null;
  let id = sessionStorage.getItem(AGENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(AGENT_ID_KEY, id);
  }
  return { id, name };
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/agent${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

function since(value: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export default function App() {
  const [brand, setBrand] = useState<Brand>(defaultBrand);
  const [agent, setAgent] = useState<Agent | null>(loadAgent);

  useEffect(() => {
    void fetchBrand().then(setBrand);
  }, []);

  if (!agent) {
    return (
      <SignIn
        brand={brand}
        onSignIn={(name) => {
          localStorage.setItem(AGENT_NAME_KEY, name);
          setAgent(loadAgent());
        }}
      />
    );
  }

  return (
    <Console
      brand={brand}
      agent={agent}
      onSignOut={() => {
        localStorage.removeItem(AGENT_NAME_KEY);
        sessionStorage.removeItem(AGENT_ID_KEY);
        setAgent(null);
      }}
    />
  );
}

function SignIn({ brand, onSignIn }: { brand: Brand; onSignIn: (name: string) => void }) {
  const [name, setName] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (name.trim()) onSignIn(name.trim());
  };

  return (
    <main className="signin">
      <form className="signin-card" onSubmit={submit}>
        <div className="brand-mark">{brand.name}<span>Support Desk</span></div>
        <h1>Start your shift</h1>
        <p>Enter the name customers will see when you join a chat.</p>
        <label>
          Display name
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoFocus required placeholder="e.g. Alex" />
        </label>
        <button className="button button-primary" type="submit" disabled={!name.trim()}>Go online</button>
        <p className="fineprint">Demo console — add authentication before using with real customers.</p>
      </form>
    </main>
  );
}

function Console({ brand, agent, onSignOut }: { brand: Brand; agent: Agent; onSignOut: () => void }) {
  const [conversations, setConversations] = useState<Record<string, ConversationSummary>>({});
  const [transcripts, setTranscripts] = useState<Record<string, LocalMessage[]>>({});
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const realtime = useRef<RealtimeConnection<ServerEvent> | null>(null);
  const selectedRef = useRef(selectedId);
  const deliveryTimers = useRef(new Map<string, number>());

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const loadList = useCallback(async () => {
    const list = await api<ConversationSummary[]>('/conversations');
    setConversations(Object.fromEntries(list.map((c) => [c.id, c])));
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const detail = await api<ConversationDetail>(`/conversations/${id}`);
    setConversations((current) => ({ ...current, [id]: detail.conversation }));
    setTranscripts((current) => {
      const pending = (current[id] ?? []).filter((m) => m.delivery && !detail.messages.some((d) => d.clientMessageId === m.clientMessageId));
      return { ...current, [id]: [...detail.messages, ...pending] };
    });
  }, []);

  const handleEvent = useCallback(
    (event: ServerEvent) => {
      switch (event.type) {
        case 'conversation': {
          const summary = event.conversation;
          setConversations((current) => ({ ...current, [summary.id]: summary }));
          // Waiting conversations aren't streamed to agents yet, so refresh the preview.
          if (summary.id === selectedRef.current && summary.agentId !== agent.id) void loadDetail(summary.id).catch(() => undefined);
          break;
        }
        case 'message': {
          const { conversationId, message } = event;
          if (message.clientMessageId) {
            window.clearTimeout(deliveryTimers.current.get(message.clientMessageId));
            deliveryTimers.current.delete(message.clientMessageId);
          }
          setTranscripts((current) => ({ ...current, [conversationId]: mergeMessage(current[conversationId] ?? [], message) }));
          if (message.sender === 'customer') {
            setTyping((current) => ({ ...current, [conversationId]: false }));
            if (conversationId !== selectedRef.current) setUnread((current) => ({ ...current, [conversationId]: (current[conversationId] ?? 0) + 1 }));
          }
          break;
        }
        case 'typing':
          if (event.sender === 'customer') setTyping((current) => ({ ...current, [event.conversationId]: event.isTyping }));
          break;
      }
    },
    [agent.id, loadDetail],
  );

  useEffect(() => {
    const connection = new RealtimeConnection<ServerEvent>({
      negotiate: async () => (await api<{ url: string }>('/negotiate', { method: 'POST', body: JSON.stringify({ agentId: agent.id, agentName: agent.name }) })).url,
      onMessage: handleEvent,
      onStateChange: setConnection,
      onConnected: () => {
        void loadList().catch(() => setError('Could not load the queue.'));
        if (selectedRef.current) void loadDetail(selectedRef.current).catch(() => undefined);
      },
    });
    realtime.current = connection;
    connection.start();
    return () => {
      connection.stop();
      realtime.current = null;
    };
  }, [agent, handleEvent, loadList, loadDetail]);

  const select = (id: string) => {
    setSelectedId(id);
    setUnread((current) => ({ ...current, [id]: 0 }));
    void loadDetail(id).catch(() => setError('Could not load that conversation.'));
  };

  const accept = async (id: string) => {
    setError(null);
    try {
      const detail = await api<ConversationDetail>(`/conversations/${id}/accept`, { method: 'POST', body: JSON.stringify({ agentId: agent.id, agentName: agent.name }) });
      setConversations((current) => ({ ...current, [id]: detail.conversation }));
      setTranscripts((current) => ({ ...current, [id]: detail.messages }));
    } catch (e) {
      setError((e as Error).message);
      void loadDetail(id).catch(() => undefined);
    }
  };

  const close = async (id: string) => {
    try {
      const detail = await api<ConversationDetail>(`/conversations/${id}/close`, { method: 'POST', body: JSON.stringify({ agentId: agent.id, agentName: agent.name }) });
      setConversations((current) => ({ ...current, [id]: detail.conversation }));
      setTranscripts((current) => ({ ...current, [id]: detail.messages }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deliver = (message: LocalMessage) => {
    const clientMessageId = message.clientMessageId!;
    const markFailed = () =>
      setTranscripts((current) => ({
        ...current,
        [message.conversationId]: (current[message.conversationId] ?? []).map((m) => (m.clientMessageId === clientMessageId && m.delivery ? { ...m, delivery: 'failed' } : m)),
      }));
    if (!realtime.current?.sendEvent('message', { conversationId: message.conversationId, text: message.text, clientMessageId })) {
      markFailed();
      return;
    }
    deliveryTimers.current.set(clientMessageId, window.setTimeout(markFailed, DELIVERY_TIMEOUT_MS));
  };

  const send = (conversationId: string, text: string) => {
    const clientMessageId = crypto.randomUUID();
    const message: LocalMessage = {
      id: `local-${clientMessageId}`,
      conversationId,
      sender: 'agent',
      senderName: agent.name,
      text,
      sentAt: new Date().toISOString(),
      clientMessageId,
      delivery: 'sending',
    };
    setTranscripts((current) => ({ ...current, [conversationId]: [...(current[conversationId] ?? []), message] }));
    deliver(message);
  };

  const retry = (message: LocalMessage) => {
    setTranscripts((current) => ({
      ...current,
      [message.conversationId]: (current[message.conversationId] ?? []).map((m) => (m.id === message.id ? { ...m, delivery: 'sending' } : m)),
    }));
    deliver(message);
  };

  const groups = useMemo(() => {
    const all = Object.values(conversations);
    const byNewest = (a: ConversationSummary, b: ConversationSummary) => (b.lastMessage?.sentAt ?? b.createdAt).localeCompare(a.lastMessage?.sentAt ?? a.createdAt);
    return {
      waiting: all.filter((c) => c.status === 'waiting').sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      mine: all.filter((c) => c.status === 'active' && c.agentId === agent.id).sort(byNewest),
      others: all.filter((c) => c.status === 'active' && c.agentId !== agent.id).sort(byNewest),
      closed: all.filter((c) => c.status === 'closed').sort(byNewest).slice(0, 10),
    };
  }, [conversations, agent.id]);

  useEffect(() => {
    document.title = groups.waiting.length ? `(${groups.waiting.length}) ${brand.name} Support Desk` : `${brand.name} Support Desk`;
  }, [groups.waiting.length, brand.name]);

  const selected = selectedId ? conversations[selectedId] : undefined;

  return (
    <div className={`console${selected ? ' has-selection' : ''}`}>
      <header className="topbar">
        <div className="brand-mark">{brand.name}<span>Support Desk</span></div>
        <ConnectionBadge state={connection} />
        <div className="agent-chip">
          <span className="avatar">{agent.name[0]}</span>
          <span className="agent-name">{agent.name}</span>
          <button type="button" className="text-button" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      {error && (
        <div className="banner" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <aside className="queue" aria-label="Conversations">
        <QueueSection title="Waiting" empty="No customers waiting" items={groups.waiting} highlight {...{ selectedId, unread, typing, now, onSelect: select }} />
        <QueueSection title="My chats" empty="Accept a chat to get started" items={groups.mine} {...{ selectedId, unread, typing, now, onSelect: select }} />
        {groups.others.length > 0 && <QueueSection title="Other agents" items={groups.others} {...{ selectedId, unread, typing, now, onSelect: select }} />}
        {groups.closed.length > 0 && <QueueSection title="Recently closed" items={groups.closed} {...{ selectedId, unread, typing, now, onSelect: select }} />}
      </aside>

      <main className="workspace">
        {selected ? (
          <ConversationView
            key={selected.id}
            conversation={selected}
            messages={transcripts[selected.id] ?? []}
            customerTyping={typing[selected.id] ?? false}
            isMine={selected.agentId === agent.id}
            connection={connection}
            now={now}
            onBack={() => setSelectedId(null)}
            onAccept={() => void accept(selected.id)}
            onClose={() => void close(selected.id)}
            onSend={(text) => send(selected.id, text)}
            onRetry={retry}
            onTyping={(isTyping) => realtime.current?.sendEvent('typing', { conversationId: selected.id, isTyping })}
          />
        ) : (
          <div className="empty-state">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4A2.5 2.5 0 0 1 4 13.5z" /></svg>
            <h2>{groups.waiting.length ? `${groups.waiting.length} customer${groups.waiting.length === 1 ? '' : 's'} waiting` : 'You’re all caught up'}</h2>
            <p>New chats from the {brand.name} website appear in the queue in real time.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const labels: Record<ConnectionState, string> = {
    idle: 'Offline',
    connecting: 'Connecting…',
    connected: 'Online',
    reconnecting: 'Reconnecting…',
    offline: 'Disconnected — retrying',
  };
  return <span className={`connection is-${state}`}>{labels[state]}</span>;
}

interface QueueSectionProps {
  title: string;
  empty?: string;
  items: ConversationSummary[];
  highlight?: boolean;
  selectedId: string | null;
  unread: Record<string, number>;
  typing: Record<string, boolean>;
  now: number;
  onSelect: (id: string) => void;
}

function QueueSection({ title, empty, items, highlight, selectedId, unread, typing, now, onSelect }: QueueSectionProps) {
  return (
    <section className="queue-section">
      <h2>
        {title} <span className={`count${highlight && items.length ? ' is-hot' : ''}`}>{items.length}</span>
      </h2>
      {items.length === 0 && empty && <p className="queue-empty">{empty}</p>}
      <ul>
        {items.map((c) => (
          <li key={c.id}>
            <button type="button" className={`queue-item${c.id === selectedId ? ' is-selected' : ''}`} onClick={() => onSelect(c.id)}>
              <span className={`avatar${c.customerOnline ? ' is-online' : ''}`}>{c.customerName[0]}</span>
              <span className="queue-text">
                <span className="queue-row">
                  <strong>{c.customerName}</strong>
                  <time>{since(c.status === 'waiting' ? c.createdAt : c.lastMessage?.sentAt ?? c.createdAt, now)}</time>
                </span>
                <span className="queue-row">
                  <span className="preview">{typing[c.id] ? 'Typing…' : c.lastMessage?.text ?? c.topic}</span>
                  {(unread[c.id] ?? 0) > 0 && <span className="unread">{unread[c.id]}</span>}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface ConversationViewProps {
  conversation: ConversationSummary;
  messages: LocalMessage[];
  customerTyping: boolean;
  isMine: boolean;
  connection: ConnectionState;
  now: number;
  onBack: () => void;
  onAccept: () => void;
  onClose: () => void;
  onSend: (text: string) => void;
  onRetry: (message: LocalMessage) => void;
  onTyping: (isTyping: boolean) => void;
}

function ConversationView({ conversation, messages, customerTyping, isMine, connection, now, onBack, onAccept, onClose, onSend, onRetry, onTyping }: ConversationViewProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLOListElement>(null);
  const typingTimer = useRef<number | undefined>(undefined);
  const typingSent = useRef(false);
  const canSend = isMine && conversation.status === 'active' && connection === 'connected';

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages.length, customerTyping]);

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
    <div className="conversation">
      <header className="conversation-header">
        <button type="button" className="back-button" onClick={onBack} aria-label="Back to queue">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
        </button>
        <span className={`avatar large${conversation.customerOnline ? ' is-online' : ''}`}>{conversation.customerName[0]}</span>
        <div className="conversation-title">
          <h2>{conversation.customerName}</h2>
          <span>
            {conversation.topic} · {conversation.customerOnline ? 'Online' : 'Offline'}
          </span>
        </div>
        <span className={`status-pill is-${conversation.status}`}>{conversation.status}</span>
        {conversation.status === 'waiting' && (
          <button type="button" className="button button-primary" onClick={onAccept}>Accept chat</button>
        )}
        {isMine && conversation.status === 'active' && (
          <button type="button" className="button button-outline" onClick={onClose}>Close chat</button>
        )}
      </header>

      <div className="conversation-body">
        <ol className="transcript" ref={listRef} aria-live="polite">
          {messages.map((message) => (
            <li key={message.id} className={`bubble-row from-${message.sender}`}>
              {message.sender === 'system' ? (
                <span className="system-note">{message.text}</span>
              ) : (
                <div className={`bubble${message.delivery === 'failed' ? ' is-failed' : ''}`}>
                  <span className="bubble-author">{message.senderName}</span>
                  <p>{message.text}</p>
                  <span className="bubble-meta">
                    {message.delivery === 'sending' && 'Sending…'}
                    {message.delivery === 'failed' && (
                      <button type="button" className="link-button" onClick={() => onRetry(message)}>Not delivered · Retry</button>
                    )}
                    {!message.delivery && formatTime(message.sentAt)}
                  </span>
                </div>
              )}
            </li>
          ))}
          {customerTyping && (
            <li className="bubble-row from-customer">
              <div className="bubble typing" aria-label={`${conversation.customerName} is typing`}><span /><span /><span /></div>
            </li>
          )}
        </ol>

        <aside className="details" aria-label="Customer details">
          <h3>Details</h3>
          <dl>
            <dt>Customer</dt><dd>{conversation.customerName}</dd>
            <dt>Topic</dt><dd>{conversation.topic}</dd>
            <dt>Waiting since</dt><dd>{formatTime(conversation.createdAt)} ({since(conversation.createdAt, now)})</dd>
            {conversation.agentName && (<><dt>Agent</dt><dd>{conversation.agentName}</dd></>)}
            <dt>Messages</dt><dd>{conversation.messageCount}</dd>
            <dt>Reference</dt><dd className="mono">{conversation.id}</dd>
          </dl>
        </aside>
      </div>

      {conversation.status === 'waiting' ? (
        <div className="composer-note">Accept this chat to reply to {conversation.customerName}.</div>
      ) : conversation.status === 'closed' ? (
        <div className="composer-note">This conversation is closed.</div>
      ) : !isMine ? (
        <div className="composer-note">{conversation.agentName} is handling this chat.</div>
      ) : (
        <form className="composer" onSubmit={submit}>
          <textarea
            value={draft}
            onChange={(e) => changeDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={canSend ? `Reply to ${conversation.customerName}…` : 'Waiting for connection…'}
            aria-label="Reply"
            rows={2}
            maxLength={2000}
          />
          <button type="submit" className="button button-primary" disabled={!canSend || !draft.trim()}>Send</button>
        </form>
      )}
    </div>
  );
}
