import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { connectCustomerOrder } from '../src/customerRealtime';
import { connectRealtime } from '../src/realtime';
import type { OrderSnapshot, Receipt } from '../src/api';
import { dropOffs, makeLine } from '../src/demo';

vi.mock('../src/realtime', () => ({ connectRealtime: vi.fn() }));
const now = Date.parse('2026-11-16T00:00:00Z');
const receipt: Receipt = { id: 'FC-123ABC', bag: [makeLine('latte')], payload: 1,
  placedAt: new Date(now).toISOString(), dropOff: dropOffs[0] };
const snapshot: OrderSnapshot = {
  order: { orderId: receipt.id, customerName: 'You', payloadBays: 1, lines: [], placedAt: receipt.placedAt,
    dropOff: { latitude: -37.84, longitude: 144.97 } },
  store: { id: 'test', name: 'Test', location: { latitude: -37.83, longitude: 144.96 } },
  readyAt: receipt.placedAt, status: 'AwaitingFleet', droneId: null, estimatedDelivery: null,
  deliveredAt: null, note: null, photos: [],
};
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const response = (status: number, value = snapshot) => new Response(JSON.stringify(value), { status });

test('fresh 202 receipt waits for registration before negotiating, without showing an error', async () => {
  fetchMock.mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(404)).mockResolvedValue(response(200));
  const receive = vi.fn(), report = vi.fn(), status = vi.fn(), controller = new AbortController();
  connectCustomerOrder(receipt, receive, report, controller.signal, status);
  await vi.advanceTimersByTimeAsync(0);
  expect(connectRealtime).not.toHaveBeenCalled();
  expect(status).toHaveBeenCalledWith('Confirming your order…');
  await vi.advanceTimersByTimeAsync(2000);
  expect(receive).toHaveBeenCalledWith(snapshot);
  expect(connectRealtime).toHaveBeenCalledTimes(1);
  expect(report).not.toHaveBeenCalled();
  expect(status).toHaveBeenLastCalledWith('');
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  controller.abort();
});

test('registration wait is bounded and stale receipts and genuine server failures remain visible', async () => {
  const report = vi.fn(), controller = new AbortController();
  fetchMock.mockResolvedValue(response(404));
  connectCustomerOrder(receipt, vi.fn(), report, controller.signal);
  await vi.advanceTimersByTimeAsync(30000);
  expect(report).toHaveBeenCalledWith(expect.stringContaining('(404)'));
  expect(connectRealtime).not.toHaveBeenCalled();
  controller.abort();

  vi.clearAllMocks();
  connectCustomerOrder({ ...receipt, placedAt: new Date(now - 60000).toISOString() }, vi.fn(), report, controller.signal);
  expect(fetchMock).not.toHaveBeenCalled();
  const next = new AbortController();
  connectCustomerOrder({ ...receipt, placedAt: new Date(now - 60000).toISOString() }, vi.fn(), report, next.signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(report).toHaveBeenCalledWith(expect.stringContaining('(404)'));
  next.abort();

  const failing = new AbortController();
  fetchMock.mockResolvedValue(response(503));
  connectCustomerOrder(receipt, vi.fn(), report, failing.signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(report).toHaveBeenCalledWith(expect.stringContaining('(503)'));
  failing.abort();
});

test('cancellation during propagation prevents late negotiation or errors', async () => {
  fetchMock.mockResolvedValue(response(404));
  const controller = new AbortController(), report = vi.fn();
  connectCustomerOrder(receipt, vi.fn(), report, controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await vi.advanceTimersByTimeAsync(10000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(connectRealtime).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
});

test('restored delivered orders render their snapshot without a live connection', async () => {
  const delivered = { ...snapshot, status: 'Delivered' as const };
  fetchMock.mockResolvedValue(response(200, delivered));
  const receive = vi.fn(), controller = new AbortController();
  connectCustomerOrder(receipt, receive, vi.fn(), controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).toHaveBeenCalledWith(delivered);
  expect(connectRealtime).not.toHaveBeenCalled();
  controller.abort();
});

test('delivery stops only its connection, preserves final snapshot, and ignores later pushes', async () => {
  fetchMock.mockImplementation(async () => response(200));
  const controller = new AbortController(), receive = vi.fn();
  connectCustomerOrder(receipt, receive, vi.fn(), controller.signal);
  await vi.advanceTimersByTimeAsync(0);
  const [, , push, recover, , signal] = vi.mocked(connectRealtime).mock.calls[0];
  await recover();
  expect(signal.aborted).toBe(false);
  const delivered = { ...snapshot, status: 'Delivered' as const };
  push(delivered);
  expect(receive).toHaveBeenLastCalledWith(delivered);
  expect(signal.aborted).toBe(true);
  expect(controller.signal.aborted).toBe(false);
  push(snapshot);
  expect(receive).toHaveBeenLastCalledWith(delivered);
  controller.abort();
});
