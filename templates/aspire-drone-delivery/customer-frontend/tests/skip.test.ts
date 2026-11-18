import { afterEach, assert, expect, test, vi } from 'vitest';
import { skipOrderStage } from '../src/api';

afterEach(() => vi.unstubAllGlobals());

test('skipping sends the current stage to the backend and accepts an empty 202', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
  vi.stubGlobal('fetch', fetch);
  await skipOrderStage('FC-123456', 'Ready for pickup');
  assert.equal(fetch.mock.calls[0][0], '/api/orders/FC-123456/demo/skip');
  assert.deepEqual(JSON.parse(fetch.mock.calls[0][1].body), { orderId: 'FC-123456', stage: 'ReadyForPickup' });
  assert.equal(fetch.mock.calls[0][1].method, 'POST');
});

test('a rejected stage surfaces its error and delivered orders cannot send a command', async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('Wait for a drone', { status: 409 }));
  vi.stubGlobal('fetch', fetch);
  await expect(skipOrderStage('FC-123456', 'Ready for pickup')).rejects.toThrow(/Wait for a drone/);
  await expect(skipOrderStage('FC-123456', 'Delivered')).rejects.toThrow(/no stage to skip/);
  assert.equal(fetch.mock.calls.length, 1);
});
