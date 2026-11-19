export type ConversationStatus = 'waiting' | 'active' | 'closed';
export type MessageSender = 'customer' | 'agent' | 'system';

export interface Brand {
  name: string;
  legalName: string;
  domain: string;
  tagline: string;
  supportTeamName: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  sender: MessageSender;
  senderName: string;
  text: string;
  sentAt: string;
  clientMessageId?: string;
}

export interface ConversationSummary {
  id: string;
  customerName: string;
  topic: string;
  status: ConversationStatus;
  agentId?: string;
  agentName?: string;
  createdAt: string;
  acceptedAt?: string;
  closedAt?: string;
  messageCount: number;
  lastMessage?: ChatMessage;
  customerOnline: boolean;
}

export interface ConversationDetail {
  conversation: ConversationSummary;
  messages: ChatMessage[];
}

export type ServerEvent =
  | { type: 'conversation'; conversation: ConversationSummary }
  | { type: 'message'; conversationId: string; message: ChatMessage }
  | { type: 'typing'; conversationId: string; sender: MessageSender; isTyping: boolean };

export const defaultBrand: Brand = {
  name: 'Contoso',
  legalName: 'Contoso, Ltd.',
  domain: 'contoso.com',
  tagline: 'Reliable energy for every home',
  supportTeamName: 'Contoso Care',
};

export async function fetchBrand(): Promise<Brand> {
  try {
    const response = await fetch('/api/brand');
    return response.ok ? { ...defaultBrand, ...(await response.json()) } : defaultBrand;
  } catch {
    return defaultBrand;
  }
}

/** Appends or replaces a message, keeping the transcript ordered and free of duplicates. */
export function mergeMessage(messages: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const index = messages.findIndex(
    (m) => m.id === message.id || (message.clientMessageId && m.clientMessageId === message.clientMessageId),
  );
  if (index >= 0) {
    const next = messages.slice();
    next[index] = message;
    return next;
  }

  return [...messages, message].sort((a, b) => a.sentAt.localeCompare(b.sentAt));
}

export function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
