import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bagTotal, demoFlights, demoReducer, dropOff, initialState, kitchen, matchSpokenOrder, orderFlight, stageTicks } from '../src/demo.ts';
import type { Order } from '../src/demo.ts';

test('voice interpretation proposes known items and quantities without placing an order', () => {
  assert.deepEqual(matchSpokenOrder('Two burgers and one bowl, please!'), { bag: { burger: 2, bowl: 1 } });
  assert.equal(bagTotal({ burger: 2, bowl: 1 }), 56);
  assert.equal(initialState.orders.length, 3);
});

test('ambiguous, unknown, modified and invalid quantities need clarification', () => {
  for (const transcript of ['', 'a curry', 'burger', 'one burger without cheese', 'zero burgers', '0 burgers', '10 burgers', '9 burgers and 1 burger', 'one pizza and whatever else']) {
    const result = matchSpokenOrder(transcript);
    assert.ok(result.error, transcript);
    assert.deepEqual(result.bag, {});
  }
});

test('only an explicit confirmation adds a customer order and copies its bag', () => {
  const bag = { burger: 1 };
  const result = demoReducer(initialState, { type: 'confirm', bag });
  bag.burger = 8;
  assert.equal(result.orders[0].customer, 'You');
  assert.equal(result.orders[0].bag.burger, 1);
  assert.equal(result.orders[0].stage, 'Preparing');
  assert.throws(() => demoReducer(initialState, { type: 'confirm', bag: { unknown: 1 } }));
  assert.throws(() => demoReducer(initialState, { type: 'confirm', bag: {} }));
});

test('manual pickup and automatic fulfillment share a complete delivery lifecycle', () => {
  let state = demoReducer(initialState, { type: 'pickup', id: 'SK-1042' });
  assert.equal(state.orders[1].stage, 'Delivering');
  state = demoReducer(state, { type: 'pickup', id: 'SK-1041' });
  assert.equal(state.orders[0].stage, 'Preparing');
  for (let tick = 0; tick < 86; tick++) state = demoReducer(state, { type: 'tick' });
  assert.ok(state.nextId > initialState.nextId, 'synthetic activity continues');
  assert.ok(!state.orders.some(order => order.id === 'SK-1041' && order.stage !== 'Delivered'));
});

test('illustrative drone cycles show all four states and return to base', () => {
  assert.equal(demoFlights(0)[0].status, 'Charging');
  assert.equal(demoFlights(20)[0].status, 'To pickup');
  assert.equal(demoFlights(40)[0].status, 'Delivering');
  assert.equal(demoFlights(80)[0].status, 'Returning');
  assert.deepEqual(demoFlights(120), demoFlights(0));
});

test('long-running synthetic activity keeps recent state bounded', () => {
  let state = initialState;
  for (let tick = 0; tick < 10000; tick++) {
    state = demoReducer(state, { type: 'tick' });
    assert.ok(state.orders.length <= 20);
    assert.ok(state.orders.filter(order => order.stage !== 'Delivered').length <= 8);
  }
});

test('an order flight waits on the kitchen pad, flies to the drop-off and lands', () => {
  const order: Order = { id: 'SK-1044', customer: 'You', bag: { burger: 1 }, stage: 'Preparing', elapsed: 0, manual: true };
  const preparing = orderFlight(order);
  assert.equal(preparing.phase, 'Awaiting drone');
  assert.equal(preparing.etaSeconds, stageTicks.preparing + stageTicks.ready + stageTicks.flight);
  const ready = orderFlight({ ...order, stage: 'Ready for pickup', elapsed: 10 });
  assert.deepEqual([ready.phase, ready.x, ready.y, ready.altitude], ['On the pad', kitchen.x, kitchen.y, 0]);
  assert.equal(ready.droneId, preparing.droneId, 'the assigned drone is stable across stages');
  const halfway = orderFlight({ ...order, stage: 'Delivering', elapsed: stageTicks.flight / 2 });
  assert.equal(halfway.phase, 'In flight');
  assert.ok(Math.abs(halfway.progress - .5) < 1e-9);
  assert.ok(halfway.altitude > 0 && halfway.remainingMetres > 0);
  assert.ok(orderFlight({ ...order, stage: 'Delivering', elapsed: 3 }, .5).progress > orderFlight({ ...order, stage: 'Delivering', elapsed: 3 }).progress, 'sub-tick interpolation moves forward');
  const landed = orderFlight({ ...order, stage: 'Delivered', elapsed: 0 });
  assert.deepEqual([landed.phase, landed.x, landed.y, landed.altitude, landed.etaSeconds, landed.remainingMetres], ['Landed', dropOff.x, dropOff.y, 0, 0, 0]);
});

test('demo skip-ahead advances only the chosen undelivered order one stage at a time', () => {
  let state = demoReducer(initialState, { type: 'confirm', bag: { taco: 2 } });
  const id = state.orders[0].id;
  for (const expected of ['Ready for pickup', 'Delivering', 'Delivered', 'Delivered']) {
    state = demoReducer(state, { type: 'advance', id });
    assert.equal(state.orders[0].stage, expected);
    assert.equal(state.orders[0].elapsed, 0);
  }
  assert.deepEqual(state.orders.slice(1), demoReducer(initialState, { type: 'confirm', bag: { taco: 2 } }).orders.slice(1));
});
