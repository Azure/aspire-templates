import { useEffect, useState } from 'react';
import { customerOrder } from './api';
import type { OrderSnapshot, Receipt } from './api';
import { validBag } from './demo';
import { connectCustomerOrder } from './customerRealtime';

const receiptKey = 'forthcoffee.orders';
function readReceipts(): { receipts: Receipt[]; error: string } {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(receiptKey) ?? '[]');
    if (!Array.isArray(parsed) || !parsed.every((value): value is Receipt => value && typeof value.id === 'string' &&
      Array.isArray(value.bag) && validBag(value.bag, value.payload) && typeof value.placedAt === 'string' &&
      typeof value.dropOff?.label === 'string' && Number.isFinite(value.dropOff.x) && Number.isFinite(value.dropOff.y))) {
      throw new Error('Saved order receipts are invalid.');
    }
    return { receipts: parsed, error: '' };
  } catch (reason) {
    return { receipts: [], error: `Cannot restore your receipts: ${reason instanceof Error ? reason.message : String(reason)}` };
  }
}

export function useCustomerOrders() {
  const [saved, setSaved] = useState(readReceipts);
  const [snapshots, setSnapshots] = useState<Record<string, OrderSnapshot>>({});
  const [now, setNow] = useState(Date.now);
  const [connectionErrors, setConnectionErrors] = useState<Record<string, string>>({});
  const [connectionStatus, setConnectionStatus] = useState<Record<string, string>>({});
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setConnectionErrors({});
    setConnectionStatus({});
    for (const receipt of saved.receipts) {
      function receive(snapshot: OrderSnapshot) {
        if (controller.signal.aborted) return;
        if (snapshot.order.orderId !== receipt.id) throw new Error('Realtime order response does not match your receipt.');
        setSnapshots(current => ({ ...current, [receipt.id]: snapshot }));
        setConnectionErrors(current => ({ ...current, [receipt.id]: '' }));
      }
      connectCustomerOrder(receipt, receive, message => {
        if (!controller.signal.aborted) setConnectionErrors(current => ({ ...current, [receipt.id]: message }));
      }, controller.signal, message => {
        if (!controller.signal.aborted) setConnectionStatus(current => ({ ...current, [receipt.id]: message }));
      });
    }
    return () => controller.abort();
  }, [saved.receipts]);
  function remember(receipt: Receipt) {
    const receipts = [receipt, ...saved.receipts].slice(0, 20);
    let error = '';
    try { localStorage.setItem(receiptKey, JSON.stringify(receipts)); }
    catch (reason) { error = `Order confirmed, but its receipt cannot be saved: ${reason instanceof Error ? reason.message : String(reason)}`; }
    setSaved({ receipts, error });
  }
  const orders = saved.receipts.flatMap(receipt => snapshots[receipt.id] ? [customerOrder(snapshots[receipt.id], receipt, now)] : []);
  const loading = saved.receipts.some(receipt => !snapshots[receipt.id] && !connectionErrors[receipt.id]);
  return { orders: orders.map(order => connectionErrors[order.id] || connectionStatus[order.id] ? { ...order, tracking: undefined, cameraPose: undefined } : order),
    error: saved.error || Object.values(connectionErrors).find(Boolean) || '',
    status: Object.values(connectionStatus).find(Boolean) || '', loading, remember, receipts: saved.receipts };
}
