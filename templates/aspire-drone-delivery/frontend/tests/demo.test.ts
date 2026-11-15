import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { bagTotal, demoFlights, demoReducer, initialState, matchSpokenOrder } from '../src/demo.ts';

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
