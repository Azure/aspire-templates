import { HubConnectionBuilder, HubConnectionState, LogLevel } from '@microsoft/signalr';

export function connectRealtime<T>(url: string, event: string, receive: (value: T) => void,
  recover: () => Promise<void>, report: (message: string) => void, signal: AbortSignal,
  status: (message: string) => void = report) {
  const connection = new HubConnectionBuilder().withUrl(url).withAutomaticReconnect([0, 1000, 3000, 10000])
    .configureLogging(LogLevel.Warning).build();
  let retry: ReturnType<typeof setTimeout>;
  connection.on(event, (value: T) => {
    if (signal.aborted) return;
    try { receive(value); }
    catch (reason) { report(`Invalid realtime update: ${reason instanceof Error ? reason.message : String(reason)}`); }
  });
  async function refresh() {
    try { await recover(); if (!signal.aborted) status(''); }
    catch (reason) { if (!signal.aborted) report(`Snapshot recovery failed: ${reason instanceof Error ? reason.message : String(reason)}`); }
  }
  connection.onreconnecting(() => {
    if (!signal.aborted) status('Reconnecting to your live updates. Your last order details are still shown.');
  });
  connection.onreconnected(() => { if (!signal.aborted) void refresh(); });
  connection.onclose(() => {
    if (!signal.aborted) {
      status('Reconnecting to your live updates. Your last order details are still shown.');
      retry = setTimeout(start, 5000);
    }
  });
  async function start() {
    if (signal.aborted || connection.state !== HubConnectionState.Disconnected) return;
    try {
      await connection.start();
      if (!signal.aborted) await refresh();
    } catch (reason) {
      if (!signal.aborted) {
        report(`Realtime unavailable: ${reason instanceof Error ? reason.message : String(reason)}`);
        retry = setTimeout(start, 2000);
      }
    }
  }
  signal.addEventListener('abort', () => { clearTimeout(retry); void connection.stop(); }, { once: true });
  void start();
}
