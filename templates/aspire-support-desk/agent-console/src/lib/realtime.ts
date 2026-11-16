// Minimal Azure Web PubSub client using the json.webpubsub.azure.v1 subprotocol.
// It negotiates a fresh client access URL on every (re)connect and reconnects
// with exponential backoff, surfacing its state so the UI can show it.

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface RealtimeOptions<TMessage> {
  negotiate: () => Promise<string>;
  onMessage: (message: TMessage) => void;
  onStateChange: (state: ConnectionState) => void;
  onConnected?: () => void;
}

const SUBPROTOCOL = 'json.webpubsub.azure.v1';
const MAX_BACKOFF_MS = 15000;

export class RealtimeConnection<TMessage> {
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private ackId = 0;
  private retryTimer: number | undefined;
  private readonly options: RealtimeOptions<TMessage>;

  constructor(options: RealtimeOptions<TMessage>) {
    this.options = options;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.retryTimer);
    this.socket?.close(1000);
    this.socket = null;
    this.options.onStateChange('idle');
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Raises a user event that Web PubSub forwards to the server's event handler. */
  sendEvent(event: string, data: unknown): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    this.socket.send(JSON.stringify({ type: 'event', event, dataType: 'json', data, ackId: ++this.ackId }));
    return true;
  }

  private async connect(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.options.onStateChange(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let url: string;
    try {
      url = await this.options.negotiate();
    } catch {
      this.scheduleReconnect();
      return;
    }

    if (this.stopped) {
      return;
    }

    const socket = new WebSocket(url, SUBPROTOCOL);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.options.onStateChange('connected');
      this.options.onConnected?.();
    };

    socket.onmessage = (event: MessageEvent<string>) => {
      try {
        const frame = JSON.parse(event.data) as { type: string; from?: string; data?: unknown };
        if (frame.type === 'message' && frame.data && typeof frame.data === 'object') {
          this.options.onMessage(frame.data as TMessage);
        }
      } catch {
        // Ignore frames that are not JSON.
      }
    };

    socket.onclose = () => {
      if (this.socket === socket) {
        this.socket = null;
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped) {
      return;
    }

    this.attempt++;
    this.options.onStateChange(this.attempt > 3 ? 'offline' : 'reconnecting');
    const delay = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.attempt) * (0.8 + Math.random() * 0.4);
    this.retryTimer = window.setTimeout(() => void this.connect(), delay);
  }
}
