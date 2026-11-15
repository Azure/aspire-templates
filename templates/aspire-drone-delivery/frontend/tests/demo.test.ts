import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { addToBag, bagTotal, bagUnits, defaultCoffee, demoFlights, demoReducer, dropOff, initialState, kitchen, linePrice, makeLine, matchSpokenOrder, orderFlight, stageTicks, validBag } from '../src/demo.ts';
import { fromLonLat, toLonLat } from '../src/mapGeometry.ts';
import type { Bag, CoffeeOptions, Order } from '../src/demo.ts';

test('voice proposes default coffees and treats without placing an order', () => {
  const proposal = [makeLine('latte'), { ...makeLine('biscuit'), quantity: 2 }];
  assert.deepEqual(matchSpokenOrder('One latte and two biscuits, please!'), { bag: proposal });
  assert.equal(bagTotal(proposal), 11.5);
  assert.equal(initialState.orders.length, 3);
  assert.deepEqual(matchSpokenOrder('two flat whites and a long black').bag, [
    { ...makeLine('flat-white'), quantity: 2 }, makeLine('long-black'),
  ]);
});

test('ambiguous, unknown, modified and invalid quantities need clarification', () => {
  for (const transcript of ['', 'a burger', 'latte', 'one latte with oat milk', 'one biscuit without nuts', 'zero lattes', '0 lattes', '10 lattes', '9 lattes and 1 latte', 'one cake and whatever else']) {
    const result = matchSpokenOrder(transcript);
    assert.ok(result.error, transcript);
    assert.deepEqual(result.bag, []);
  }
});

test('single, double and quad packing rules reject overflow, but allow partly filled payloads', () => {
  const coffee = makeLine('flat-white');
  assert.ok(validBag([coffee], 1));
  assert.ok(validBag([coffee], 4));
  assert.ok(!validBag([coffee, makeLine('biscuit')], 1));
  const packed = [coffee, makeLine('cake'), { ...makeLine('biscuit'), quantity: 2 }];
  assert.equal(bagUnits(packed), 8);
  assert.ok(validBag(packed, 2));
  assert.ok(!validBag([...packed, makeLine('croissant')], 2));
  assert.ok(validBag([{ ...coffee, quantity: 4 }], 4));
  assert.ok(!validBag([{ ...coffee, quantity: 5 }], 4));
  assert.throws(() => addToBag([coffee], makeLine('biscuit'), 1), /does not fit/);
  assert.deepEqual(addToBag([makeLine('biscuit')], makeLine('biscuit'), 1), [{ ...makeLine('biscuit'), quantity: 2 }]);
});

test('coffee variants keep separate identities, prices and details while identical cups merge', () => {
  const regular = makeLine('latte');
  const custom = makeLine('latte', { size: 'Large', milk: 'Oat', shots: 3, sugar: 1, temperature: 'Iced' });
  assert.notEqual(regular.id, custom.id);
  assert.equal(linePrice(regular), 5.5);
  assert.equal(linePrice(custom), 7.5);
  let bag = addToBag([], regular, 4);
  bag = addToBag(bag, custom, 4);
  bag = addToBag(bag, regular, 4);
  assert.equal(bag.length, 2);
  assert.deepEqual(bag.map(line => line.quantity), [2, 1]);
  assert.equal(bagTotal(bag), 18.5);
  assert.equal(bagUnits(bag), 12, 'size, milk and shots never change the cup well count');
  assert.equal(makeLine('long-black').coffee?.milk, 'None');
});

test('invalid configurations and tampered line identities cannot be confirmed', () => {
  const invalidMilk = { ...defaultCoffee('latte'), milk: 'Unknown' } as unknown as CoffeeOptions;
  assert.throws(() => makeLine('latte', invalidMilk), /supported coffee/);
  const invalid = [
    [],
    [{ ...makeLine('latte'), quantity: -1 }],
    [{ ...makeLine('latte'), quantity: 1.5 }],
    [{ ...makeLine('latte'), coffee: undefined }],
    [{ ...makeLine('latte'), coffee: invalidMilk }],
    [{ ...makeLine('latte'), id: 'tampered' }],
    [{ ...makeLine('biscuit'), itemId: 'unknown' }],
    [{ ...makeLine('biscuit'), coffee: defaultCoffee('latte') }],
    [makeLine('latte'), makeLine('latte')],
  ];
  for (const bag of invalid) {
    assert.equal(validBag(bag), false);
    assert.throws(() => demoReducer(initialState, { type: 'confirm', bag, payload: 4 }), /valid items/);
  }
});

test('confirmation preserves the payload and snapshots every coffee customization', () => {
  const bag: Bag = [makeLine('latte', { ...defaultCoffee('latte'), milk: 'Oat', temperature: 'Iced' })];
  const result = demoReducer(initialState, { type: 'confirm', bag, payload: 2 });
  bag[0].quantity = 8;
  bag[0].coffee!.milk = 'Soy';
  assert.equal(result.orders[0].customer, 'You');
  assert.equal(result.orders[0].payload, 2);
  assert.equal(result.orders[0].bag[0].quantity, 1);
  assert.equal(result.orders[0].bag[0].coffee?.milk, 'Oat');
  assert.equal(result.orders[0].bag[0].coffee?.temperature, 'Iced');
  assert.equal(result.orders[0].stage, 'Preparing');
  assert.throws(() => demoReducer(initialState, { type: 'confirm', bag: [makeLine('latte'), makeLine('cake')], payload: 1 }));
});

test('manual pickup and automatic fulfillment share a complete delivery lifecycle', () => {
  let state = demoReducer(initialState, { type: 'pickup', id: 'FC-1042' });
  assert.equal(state.orders[1].stage, 'Delivering');
  state = demoReducer(state, { type: 'pickup', id: 'FC-1041' });
  assert.equal(state.orders[0].stage, 'Preparing');
  for (let tick = 0; tick < 86; tick++) state = demoReducer(state, { type: 'tick' });
  assert.ok(state.nextId > initialState.nextId);
  assert.ok(!state.orders.some(order => order.id === 'FC-1041' && order.stage !== 'Delivered'));
});

test('illustrative drone cycles show all four states and return to base', () => {
  assert.equal(demoFlights(0)[0].status, 'Charging');
  assert.equal(demoFlights(20)[0].status, 'To pickup');
  assert.equal(demoFlights(40)[0].status, 'Delivering');
  assert.equal(demoFlights(80)[0].status, 'Returning');
  assert.deepEqual(demoFlights(120), demoFlights(0));
});

test('long-running synthetic activity stays bounded and uses valid coffee payloads', () => {
  let state = initialState;
  for (let tick = 0; tick < 10000; tick++) {
    state = demoReducer(state, { type: 'tick' });
    assert.ok(state.orders.length <= 20);
    assert.ok(state.orders.filter(order => order.stage !== 'Delivered').length <= 8);
    assert.ok(state.orders.every(order => validBag(order.bag, order.payload)));
  }
});

test('an order flight waits at the bar, flies to the drop-off and lands', () => {
  const order: Order = { id: 'FC-1044', customer: 'You', bag: [makeLine('flat-white')], payload: 1, stage: 'Preparing', elapsed: 0, manual: true };
  const preparing = orderFlight(order);
  assert.equal(preparing.phase, 'Awaiting drone');
  assert.equal(preparing.etaSeconds, stageTicks.preparing + stageTicks.ready + stageTicks.flight);
  const ready = orderFlight({ ...order, stage: 'Ready for pickup', elapsed: 10 });
  assert.deepEqual([ready.phase, ready.x, ready.y, ready.altitude], ['On the pad', kitchen.x, kitchen.y, 0]);
  assert.equal(ready.droneId, preparing.droneId);
  const halfway = orderFlight({ ...order, stage: 'Delivering', elapsed: stageTicks.flight / 2 });
  assert.equal(halfway.phase, 'In flight');
  assert.ok(Math.abs(halfway.progress - .5) < 1e-9);
  assert.ok(halfway.altitude > 0 && halfway.remainingMetres > 0);
  assert.ok(orderFlight({ ...order, stage: 'Delivering', elapsed: 3 }, .5).progress > orderFlight({ ...order, stage: 'Delivering', elapsed: 3 }).progress);
  const landed = orderFlight({ ...order, stage: 'Delivered', elapsed: 0 });
  assert.deepEqual([landed.phase, landed.x, landed.y, landed.altitude, landed.etaSeconds, landed.remainingMetres], ['Landed', dropOff.x, dropOff.y, 0, 0, 0]);
});

test('demo skip-ahead advances only the chosen undelivered order', () => {
  let state = demoReducer(initialState, { type: 'confirm', bag: [makeLine('latte')], payload: 1 });
  const id = state.orders[0].id;
  for (const expected of ['Ready for pickup', 'Delivering', 'Delivered', 'Delivered']) {
    state = demoReducer(state, { type: 'advance', id });
    assert.equal(state.orders[0].stage, expected);
    assert.equal(state.orders[0].elapsed, 0);
  }
  assert.deepEqual(state.orders.slice(1), initialState.orders);
});

test('both map modes use South Melbourne coordinates and round-trip the delivery route', () => {
  for (const point of [kitchen, dropOff]) {
    const [lon, lat] = toLonLat(point.x, point.y);
    assert.ok(lon > 144.95 && lon < 144.98 && lat > -37.85 && lat < -37.82);
    const back = fromLonLat(lon, lat);
    assert.ok(Math.abs(back.x - point.x) < 1e-6 && Math.abs(back.y - point.y) < 1e-6);
  }
});
