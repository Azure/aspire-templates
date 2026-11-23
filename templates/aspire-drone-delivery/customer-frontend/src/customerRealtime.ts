import type { OrderSnapshot, Receipt } from './api';
import { connectRealtime } from './realtime';
import { recordReceipt, traced } from './telemetry';

function waitForRegistration(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function connectCustomerOrder(receipt: Receipt, receive: (snapshot: OrderSnapshot) => void,
  report: (message: string) => void, signal: AbortSignal, status: (message: string) => void = () => {}) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  if (signal.aborted) return;
  signal.addEventListener('abort', stop, { once: true });
  controller.signal.addEventListener('abort', () => signal.removeEventListener('abort', stop), { once: true });

  function apply(snapshot: OrderSnapshot, traceparent?: string) {
    if (controller.signal.aborted) return;
    if (snapshot.order.orderId !== receipt.id) throw new Error('Realtime order response does not match your receipt.');
    receive(snapshot);
    recordReceipt('customer receive order update', traceparent, {
      'drone_delivery.order.id': receipt.id, 'drone_delivery.order.status': snapshot.status, 'messaging.system': 'signalr',
    });
    status('');
    if (snapshot.status === 'Delivered' || snapshot.status === 'Failed' || snapshot.status === 'Unserviceable') stop();
  }

  async function recover(waitForAcceptedOrder = false) {
    while (!controller.signal.aborted) {
      const response = await traced('customer load order', { 'drone_delivery.order.id': receipt.id },
        () => fetch(`/api/orders/${encodeURIComponent(receipt.id)}`, { signal: controller.signal }));
      // POST returns 202 before the Event Hubs consumer registers the order. Only a
      // freshly accepted receipt gets this bounded readiness wait, never a live polling loop.
      if (response.status === 404 && waitForAcceptedOrder && Date.now() - Date.parse(receipt.placedAt) < 30000) {
        status('Confirming your order…');
        await waitForRegistration(controller.signal);
        continue;
      }
      if (!response.ok) throw new Error(`Order ${receipt.id} unavailable (${response.status}); the demo server may have restarted.`);
      apply(await response.json() as OrderSnapshot);
      return;
    }
  }

  async function start() {
    try {
      await recover(true);
      if (!controller.signal.aborted) {
        connectRealtime<OrderSnapshot>(`/realtime/customer?orderId=${encodeURIComponent(receipt.id)}`,
          'orderUpdated', apply, () => recover(), report, controller.signal, status);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        status('');
        report(`Order snapshot unavailable: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    }
  }
  void start();
}
