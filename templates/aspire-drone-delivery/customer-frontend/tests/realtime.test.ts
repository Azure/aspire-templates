import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { connectRealtime } from '../src/realtime';

const hub = vi.hoisted(() => ({
  start: vi.fn(), stop: vi.fn(), state: 'Disconnected', handlers: new Map<string, (value: unknown) => void>(),
  reconnecting: () => {}, reconnected: () => {}, closed: () => {},
}));
vi.mock('@microsoft/signalr', () => ({
  HubConnectionState: { Disconnected: 'Disconnected' }, LogLevel: { Warning: 3 },
  HubConnectionBuilder: class {
    withUrl() { return this; }
    withAutomaticReconnect() { return this; }
    configureLogging() { return this; }
    build() {
      return {
        get state() { return hub.state; }, start: hub.start, stop: hub.stop,
        on: (name: string, callback: (value: unknown) => void) => hub.handlers.set(name, callback),
        onreconnecting: (callback: () => void) => { hub.reconnecting = callback; },
        onreconnected: (callback: () => void) => { hub.reconnected = callback; },
        onclose: (callback: () => void) => { hub.closed = callback; },
      };
    }
  },
}));
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); hub.handlers.clear(); hub.state = 'Disconnected';
  hub.start.mockImplementation(async () => { hub.state = 'Connected'; });
  hub.stop.mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

test('receives subscribed push messages and recovers snapshots after reconnect', async () => {
  const controller = new AbortController(), receive = vi.fn(), recover = vi.fn().mockResolvedValue(undefined), report = vi.fn();
  connectRealtime('/realtime/customer?orderId=FC-A', 'orderUpdated', receive, recover, report, controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(recover).toHaveBeenCalledTimes(1);
  expect([...hub.handlers.keys()]).toEqual(['orderUpdated']);
  hub.handlers.get('orderUpdated')?.({ orderId: 'FC-A' });
  expect(receive).toHaveBeenCalledWith({ orderId: 'FC-A' });
  hub.reconnecting();
  expect(report).toHaveBeenCalledWith(expect.stringContaining('Reconnecting'));
  hub.reconnected();
  await vi.advanceTimersByTimeAsync(0);
  expect(recover).toHaveBeenCalledTimes(2);
  controller.abort();
  expect(hub.stop).toHaveBeenCalledTimes(1);
});

test('failed initial negotiation retries and abort prevents more connections', async () => {
  hub.start.mockRejectedValue(new Error('negotiate unavailable'));
  const controller = new AbortController(), report = vi.fn();
  connectRealtime('/realtime/operator', 'snapshot', vi.fn(), vi.fn(), report, controller.signal);
  await vi.advanceTimersByTimeAsync(2000);
  expect(hub.start).toHaveBeenCalledTimes(2);
  expect(report).toHaveBeenCalledWith(expect.stringContaining('negotiate unavailable'));
  controller.abort();
  await vi.advanceTimersByTimeAsync(10000);
  expect(hub.start).toHaveBeenCalledTimes(2);
});

test('invalid pushed data is surfaced rather than silently keeping a live view', async () => {
  const controller = new AbortController(), report = vi.fn();
  connectRealtime('/realtime/customer', 'orderUpdated', () => { throw new Error('wrong receipt'); },
    vi.fn().mockResolvedValue(undefined), report, controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  hub.handlers.get('orderUpdated')?.({});
  expect(report).toHaveBeenCalledWith('Invalid realtime update: wrong receipt');
  controller.abort();
});

test('ordinary reconnect is a status, but negotiation failure remains an error and terminal abort stays quiet', async () => {
  const controller = new AbortController(), report = vi.fn(), status = vi.fn();
  connectRealtime('/realtime/customer', 'orderUpdated', vi.fn(),
    vi.fn().mockResolvedValue(undefined), report, controller.signal, status);
  await vi.advanceTimersByTimeAsync(0);
  hub.reconnecting();
  expect(status).toHaveBeenCalledWith(expect.stringContaining('Reconnecting'));
  expect(report).not.toHaveBeenCalled();
  hub.reconnected();
  await vi.advanceTimersByTimeAsync(0);
  expect(status).toHaveBeenLastCalledWith('');
  controller.abort();
  report.mockClear(); status.mockClear();
  hub.reconnecting(); hub.closed(); hub.reconnected();
  await vi.advanceTimersByTimeAsync(10000);
  expect(report).not.toHaveBeenCalled();
  expect(status).not.toHaveBeenCalled();
});
