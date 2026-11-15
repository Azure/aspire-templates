import { strict as assert } from 'node:assert';
import { test } from 'vitest';
import { addToBag, bagFromBays, baysFromBag, bagTotal, canPickup, emptyBays, resizeBays, bagUnits, defaultCoffee, demoFlights, demoReducer, destinationFor, dropOffs, initialState, kitchen, linePrice, makeLine, matchSpokenOrder, orderFlight, stageTicks, validBag } from '../src/demo.ts';
import { fromLonLat, toLonLat } from '../src/mapGeometry.ts';
import type { Bag, Bays, CoffeeOptions, Order } from '../src/demo.ts';

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

test('every coffee or treat fills exactly one bay of a single, double or quad payload', () => {
  const coffee = makeLine('flat-white');
  assert.ok(validBag([coffee], 1));
  assert.ok(validBag([coffee], 4));
  assert.ok(!validBag([coffee, makeLine('biscuit')], 1));
  assert.ok(validBag([coffee, makeLine('biscuit')], 2));
  const packed = [coffee, makeLine('cake'), { ...makeLine('biscuit'), quantity: 2 }];
  assert.equal(bagUnits(packed), 16);
  assert.ok(!validBag(packed, 2));
  assert.ok(validBag(packed, 4));
  assert.ok(!validBag([...packed, makeLine('croissant')], 4));
  assert.ok(!validBag([{ ...coffee, quantity: 5 }], 4));
  assert.throws(() => addToBag([makeLine('biscuit')], makeLine('biscuit'), 1), /does not fit/);
  assert.deepEqual(addToBag([makeLine('biscuit')], makeLine('biscuit'), 2), [{ ...makeLine('biscuit'), quantity: 2 }]);
});

test('bays hold one item each, keep their positions and round-trip to an order bag', () => {
  const latte = makeLine('latte');
  let bays: Bays = emptyBays(4);
  bays[2] = latte; bays[0] = makeLine('cake'); bays[3] = latte;
  assert.deepEqual(bagFromBays(bays), [makeLine('cake'), { ...latte, quantity: 2 }]);
  assert.deepEqual(resizeBays(bays, 4), bays);
  bays = [makeLine('cake'), null, latte, null];
  assert.deepEqual(resizeBays(bays, 2), [makeLine('cake'), latte]);
  assert.deepEqual(resizeBays([latte], 2), [latte, null]);
  assert.throws(() => resizeBays([latte, latte, latte, null], 2), /smaller payload/);
  assert.deepEqual(baysFromBag([{ ...latte, quantity: 2 }], 4), [latte, latte, null, null]);
  assert.throws(() => baysFromBag([{ ...latte, quantity: 3 }], 2), /more bays/);
  const bag = bagFromBays([latte, latte]);
  bag[0].coffee!.milk = 'Soy';
  assert.equal(latte.coffee?.milk, 'Full cream', 'bags never share coffee options with bays');
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
  assert.equal(bagUnits(bag), 12, 'size, milk and shots never change the bay count');
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
  let state = demoReducer({ ...initialState, orders: initialState.orders.map(order => order.id === 'FC-1042' ? { ...order, elapsed: stageTicks.pickupFlight } : order) }, { type: 'pickup', id: 'FC-1042' });
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

test('an order waits for assignment, follows its inbound leg, flies to the drop-off and lands', () => {
  const order: Order = { id: 'FC-1044', customer: 'You', bag: [makeLine('flat-white')], payload: 1, stage: 'Preparing', elapsed: 0, manual: true };
  const preparing = orderFlight(order);
  assert.equal(preparing.phase, 'Awaiting drone');
  assert.equal(preparing.etaSeconds, stageTicks.preparing + stageTicks.ready + stageTicks.flight);
  assert.equal(preparing.droneId, null);
  const drone = { id: 'FC-05', pickupOrigin: dropOffs[0], assignedAt: 0 };
  const ready = orderFlight({ ...order, drone, stage: 'Ready for pickup', elapsed: stageTicks.pickupFlight });
  assert.deepEqual([ready.phase, ready.x, ready.y, ready.altitude], ['On the pad', kitchen.x, kitchen.y, 0]);
  assert.equal(ready.droneId, drone.id);
  const halfway = orderFlight({ ...order, drone, stage: 'Delivering', elapsed: stageTicks.flight / 2 });
  assert.equal(halfway.phase, 'In flight');
  assert.ok(Math.abs(halfway.progress - .5) < 1e-9);
  assert.ok(halfway.altitude > 0 && halfway.remainingMetres > 0);
  assert.ok(orderFlight({ ...order, stage: 'Delivering', elapsed: 3 }, .5).progress > orderFlight({ ...order, stage: 'Delivering', elapsed: 3 }).progress);
  const landed = orderFlight({ ...order, drone, stage: 'Delivered', elapsed: 0 });
  assert.deepEqual([landed.phase, landed.x, landed.y, landed.altitude, landed.etaSeconds, landed.remainingMetres], ['Landed', destinationFor(order).x, destinationFor(order).y, 0, 0, 0]);
});

test('drones take off and land vertically with the camera looking straight down', () => {
  const order: Order = { id: 'FC-1044', customer: 'You', bag: [makeLine('flat-white')], payload: 1, stage: 'Delivering', elapsed: 0, manual: true, drone: { id: 'FC-05', pickupOrigin: dropOffs[0], assignedAt: 0 } };
  const at = (ticks: number) => orderFlight({ ...order, elapsed: ticks });
  const destination = destinationFor(order);
  for (const ticks of [0, 1, 2, 3, 4, 5]) {
    const climb = at(ticks * stageTicks.flight * .15 / 5 * .999);
    assert.deepEqual([climb.x, climb.y], [kitchen.x, kitchen.y], 'no horizontal movement while climbing');
    const descent = at(stageTicks.flight - ticks * stageTicks.flight * .15 / 5 * .999);
    assert.ok(Math.abs(descent.x - destination.x) < 1e-9 && Math.abs(descent.y - destination.y) < 1e-9, 'no horizontal movement while descending');
    assert.equal(climb.cameraDown, 1);
    assert.equal(descent.cameraDown, 1);
  }
  assert.equal(at(stageTicks.flight * .15 * .99).manoeuvre, 'Vertical climb');
  assert.ok(at(stageTicks.flight * .15 * .99).altitude > 50);
  const cruise = at(stageTicks.flight / 2);
  assert.deepEqual([cruise.manoeuvre, cruise.altitude, cruise.cameraDown], ['Cruise', 60, 0]);
  assert.equal(at(stageTicks.flight * .9).manoeuvre, 'Vertical descent');
  const ready = orderFlight({ ...order, stage: 'Ready for pickup', elapsed: 0 });
  assert.equal(ready.cameraDown, 1);
  assert.equal(orderFlight({ ...order, stage: 'Ready for pickup', elapsed: stageTicks.ready }).cameraDown, 1);
});

test('consecutive orders fly to different drop-offs', () => {
  let state = initialState;
  const seen: string[] = [];
  for (let i = 0; i < dropOffs.length; i++) {
    state = demoReducer(state, { type: 'confirm', bag: [makeLine('latte')], payload: 1 });
    seen.push(orderFlight(state.orders[0]).destination.label);
  }
  assert.equal(new Set(seen).size, dropOffs.length);
});

test('demo skip-ahead advances only the chosen undelivered order', () => {
  const opening = { ...initialState, orders: [] };
  let state = demoReducer(opening, { type: 'confirm', bag: [makeLine('latte')], payload: 1 });
  const id = state.orders[0].id;
  for (const expected of ['Ready for pickup', 'Delivering', 'Delivered', 'Delivered']) {
    state = demoReducer(state, { type: 'advance', id });
    assert.equal(state.orders[0].stage, expected);
    assert.equal(state.orders[0].elapsed, 0);
  }
  assert.deepEqual(state.orders.slice(1), opening.orders);
});

test('ready tracking follows only its assigned drone toward pickup, not the customer', () => {
  const order = initialState.orders[1];
  const start = orderFlight(order);
  const cruise = orderFlight({ ...order, elapsed: stageTicks.pickupFlight / 2 });
  assert.equal(cruise.phase, 'To pickup');
  assert.equal(cruise.droneId, order.drone?.id);
  assert.deepEqual(cruise.origin, order.drone?.pickupOrigin);
  assert.deepEqual([cruise.target.x, cruise.target.y], [kitchen.x, kitchen.y]);
  assert.notDeepEqual(cruise.target, cruise.destination);
  assert.deepEqual([cruise.x, cruise.y], [(start.x + kitchen.x) / 2, (start.y + kitchen.y) / 2]);
  assert.ok(cruise.remainingMetres < start.remainingMetres);
  assert.ok(orderFlight({ ...order, elapsed: 8 }, .5).progress > orderFlight({ ...order, elapsed: 8 }).progress);
  assert.equal(order.stage, 'Ready for pickup');
});

test('inbound VTOL lands with a downward camera and tracking continues through pickup', () => {
  const order = initialState.orders[1];
  for (const elapsed of [0, 1, 2, 3]) {
    const climb = orderFlight({ ...order, elapsed });
    assert.deepEqual([climb.x, climb.y], [order.drone?.pickupOrigin.x, order.drone?.pickupOrigin.y]);
    assert.equal(climb.cameraDown, 1);
    const descent = orderFlight({ ...order, elapsed: stageTicks.pickupFlight - elapsed });
    assert.deepEqual([descent.x, descent.y], [kitchen.x, kitchen.y]);
    assert.equal(descent.cameraDown, 1);
  }
  const atPad = { ...order, elapsed: stageTicks.pickupFlight };
  const inbound = orderFlight(atPad);
  const pickedUp = demoReducer({ ...initialState, orders: [atPad] }, { type: 'pickup', id: order.id }).orders[0];
  const outbound = orderFlight(pickedUp);
  assert.deepEqual([inbound.droneId, inbound.x, inbound.y, inbound.altitude, inbound.cameraDown],
    [outbound.droneId, outbound.x, outbound.y, outbound.altitude, outbound.cameraDown]);
  assert.deepEqual(pickedUp.drone, order.drone);
  assert.equal(outbound.phase, 'In flight');
  assert.deepEqual(outbound.origin, kitchen);
  assert.deepEqual(outbound.target, outbound.destination);
});

test('unassigned ready orders have no live drone and wait without dispatching', () => {
  const waiting: Order = { ...initialState.orders[0], stage: 'Ready for pickup', elapsed: 80 };
  assert.equal(orderFlight(waiting).droneId, null);
  assert.equal(orderFlight(waiting).phase, 'Awaiting drone');
  assert.equal(canPickup(waiting), false);
  for (const type of ['pickup', 'advance'] as const) {
    assert.equal(demoReducer({ ...initialState, orders: [...initialState.orders.slice(1), waiting] }, { type, id: waiting.id }).orders[2].stage, 'Ready for pickup');
  }
  const state = demoReducer({ ...initialState, orders: [...initialState.orders.slice(1), waiting] }, { type: 'tick' });
  assert.equal(state.orders[2].drone, undefined, 'busy drones are not assigned to another order');
  assert.equal(state.orders[2].stage, 'Ready for pickup');
});

test('late assignment waits for the whole inbound leg and uses the drone’s last landing', () => {
  const delivered = { ...initialState.orders[2], elapsed: stageTicks.flight - 1 };
  const waiting: Order = { ...initialState.orders[0], stage: 'Ready for pickup', elapsed: 80 };
  let state = demoReducer({ ...initialState, orders: [initialState.orders[1], delivered, waiting] }, { type: 'tick' });
  const assigned = state.orders[2];
  assert.equal(assigned.drone?.id, delivered.drone?.id);
  assert.deepEqual(assigned.drone?.pickupOrigin, destinationFor(delivered));
  assert.equal(assigned.drone?.assignedAt, 81);
  assert.equal(orderFlight(assigned).progress, 0);
  assert.equal(demoReducer(state, { type: 'pickup', id: assigned.id }).orders[2].stage, 'Ready for pickup');
  for (let i = 0; i < stageTicks.pickupFlight - 1; i++) state = demoReducer(state, { type: 'tick' });
  assert.equal(state.orders[2].stage, 'Ready for pickup');
  assert.equal(canPickup(state.orders[2]), false);
  state = demoReducer(state, { type: 'tick' });
  assert.equal(state.orders[2].stage, 'Delivering');
  assert.equal(state.orders[2].drone?.id, assigned.drone?.id);
});

test('both map modes use South Melbourne coordinates and round-trip the delivery route', () => {
  for (const point of [kitchen, ...dropOffs]) {
    const [lon, lat] = toLonLat(point.x, point.y);
    assert.ok(lon > 144.95 && lon < 144.98 && lat > -37.85 && lat < -37.82);
    const back = fromLonLat(lon, lat);
    assert.ok(Math.abs(back.x - point.x) < 1e-6 && Math.abs(back.y - point.y) < 1e-6);
  }
});
