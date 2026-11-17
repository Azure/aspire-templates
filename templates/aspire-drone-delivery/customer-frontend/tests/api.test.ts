import { assert, test, vi } from 'vitest';
import { customerOrder, placeOrder, stageFor, trackingFor } from '../src/api';
import type { OrderSnapshot, Receipt, Telemetry } from '../src/api';
import { dropOffs, makeLine, orderFlight, randomDropOff } from '../src/demo';
import { fromLonLat } from '../src/mapGeometry';

const now = Date.parse('2026-11-16T00:00:00Z');
const telemetry: Telemetry = {
  droneId: 'PIC-01', class: 'Piccolo', sequence: 2, timestamp: new Date(now).toISOString(),
  position: { latitude: -37.838, longitude: 144.967 }, homePad: { latitude: -37.842, longitude: 144.972 },
  altitudeMetres: 60, heading: 310, batteryPercent: 80, state: 'FlyingToPickup', manoeuvre: 'Cruise',
  orderId: 'FC-TEST', queuedMissions: 0, flightProgress: .4,
};
const snapshot: OrderSnapshot = {
  order: { orderId: 'FC-TEST', customerName: 'You', dropOff: { latitude: -37.840, longitude: 144.970 },
    payloadBays: 1, lines: [{ item: 'Latte', bays: 1 }], placedAt: new Date(now - 90000).toISOString() },
  store: { id: 'coventry', name: 'ForthCoffee, Coventry Street', location: { latitude: -37.8318, longitude: 144.958 } },
  readyAt: new Date(now - 30000).toISOString(), status: 'Scheduled', droneId: 'PIC-01',
  estimatedDelivery: new Date(now + 120000).toISOString(), deliveredAt: null, note: null, photos: [], telemetry,
};
const receipt: Receipt = { id: 'FC-TEST', bag: [makeLine('latte')], payload: 1, placedAt: snapshot.order.placedAt, dropOff: dropOffs[0] };

test('ready stage depends on preparation, not drone departure or position', () => {
  assert.equal(stageFor(snapshot, now), 'Ready for pickup');
  assert.equal(stageFor({ ...snapshot, readyAt: new Date(now + 10000).toISOString() }, now), 'Preparing');
  assert.equal(stageFor({ ...snapshot, status: 'PickedUp' }, now), 'Delivering');
  assert.equal(stageFor({ ...snapshot, status: 'Delivered' }, now), 'Delivered');
});

test('inbound tracking and camera use the matching API fix and target the store', () => {
  const order = customerOrder(snapshot, receipt, now);
  assert.equal(order.stage, 'Ready for pickup');
  const flight = orderFlight(order, .9);
  assert.equal(flight.phase, 'To pickup');
  assert.equal(flight.droneId, 'PIC-01');
  assert.equal(flight.altitude, 60);
  assert.equal(flight.cameraDown, 0);
  assert.equal(flight.target.label, 'ForthCoffee pickup');
  assert.notDeepEqual(flight.target, flight.destination);
  assert.deepEqual(orderFlight(order, 0), flight, 'browser time cannot fabricate movement beyond telemetry');
});

test('tracking and camera keep the simulator detour and attitude instead of drawing a straight delivery leg', () => {
  const plannedRoute = [
    { position: telemetry.homePad, altitudeMetres: 12 },
    { position: telemetry.homePad, altitudeMetres: 60 },
    { position: { latitude: -37.835, longitude: 144.971 }, altitudeMetres: 60 },
    { position: snapshot.store.location, altitudeMetres: 60 },
    { position: snapshot.store.location, altitudeMetres: 15 },
  ];
  const order = customerOrder({ ...snapshot, telemetry: {
    ...telemetry, plannedRoute, pitchDegrees: 1.4, rollDegrees: -1.7,
  } }, receipt, now);
  assert.deepEqual(order.tracking?.route, plannedRoute.map(p => fromLonLat(p.position.longitude, p.position.latitude)));
  assert.deepEqual(order.cameraPose?.plannedRoute, plannedRoute);
  assert.equal(order.cameraPose?.pitchDegrees, 1.4);
  assert.equal(order.cameraPose?.rollDegrees, -1.7);
});

test('inbound leg targets the assigned store pad and the camera gets the store pads at deck height', () => {
  const pad = { latitude: -37.83176, longitude: 144.95795 };
  const store = { ...snapshot.store, deckAltitudeMetres: 18, pads: [
    { id: 'coventry-1', location: pad }, { id: 'coventry-2', location: { latitude: -37.83176, longitude: 144.95805 } }] };
  const order = customerOrder({ ...snapshot, store, telemetry: { ...telemetry, padId: 'coventry-1',
    plannedRoute: [{ position: telemetry.homePad, altitudeMetres: 60 }, { position: pad, altitudeMetres: 18 }] } }, receipt, now);
  assert.deepEqual({ x: order.tracking?.target.x, y: order.tracking?.target.y }, fromLonLat(pad.longitude, pad.latitude));
  assert.deepEqual(order.pads?.map(item => [item.id, item.altitudeMetres]), [['coventry-1', 18], ['coventry-2', 18]]);
  assert.deepEqual(customerOrder({ ...snapshot, telemetry }, receipt, now).tracking?.target.x,
    fromLonLat(snapshot.store.location.longitude, snapshot.store.location.latitude).x, 'without a route the store is the target');
});

test('queued assignment, unrelated telemetry, returning and stale fixes never become live views', () => {
  for (const update of [
    { ...snapshot, droneId: null }, { ...snapshot, telemetry: null },
    { ...snapshot, telemetry: { ...telemetry, droneId: 'PIC-02' } },
    { ...snapshot, telemetry: { ...telemetry, orderId: 'FC-OTHER' } },
    { ...snapshot, telemetry: { ...telemetry, state: 'ReturningToPad' as const } },
    { ...snapshot, telemetry: { ...telemetry, timestamp: new Date(now - 31000).toISOString() } },
  ]) assert.equal(trackingFor(update, now), undefined);
});

test('downward camera and the same assignment carry through landing, loading and delivery', () => {
  const landed = customerOrder({ ...snapshot, telemetry: { ...telemetry, state: 'Loading', manoeuvre: 'OnTheGround', altitudeMetres: 0, position: snapshot.store.location } }, receipt, now);
  const outbound = customerOrder({ ...snapshot, status: 'PickedUp', telemetry: { ...telemetry, state: 'FlyingToCustomer', manoeuvre: 'VerticalClimb', altitudeMetres: 0, position: snapshot.store.location } }, receipt, now);
  assert.equal(landed.stage, 'Ready for pickup');
  assert.equal(outbound.stage, 'Delivering');
  assert.equal(landed.tracking?.phase, 'On the pad');
  assert.equal(outbound.tracking?.phase, 'In flight');
  assert.deepEqual([landed.tracking?.droneId, landed.tracking?.x, landed.tracking?.y, landed.tracking?.cameraDown],
    [outbound.tracking?.droneId, outbound.tracking?.x, outbound.tracking?.y, outbound.tracking?.cameraDown]);
});

test('receipt identity, recipes and partial quad capacity are preserved', () => {
  const quad = { ...receipt, payload: 4 as const };
  assert.equal(customerOrder(snapshot, quad, now).payload, 4);
  assert.deepEqual(customerOrder(snapshot, quad, now).bag, receipt.bag);
  assert.throws(() => customerOrder({ ...snapshot, order: { ...snapshot.order, orderId: 'FC-OTHER' } }, receipt, now), /receipt/);
});

test('a completed order keeps its landing proof rather than the subsequent return-flight frame', () => {
  const landing = { blobName: `${telemetry.droneId}/landing.svg`, trigger: 'LandingEnd', proofOfDelivery: true, timestamp: telemetry.timestamp };
  const returning = { blobName: `${telemetry.droneId}/return.svg`, trigger: 'TakeoffStart', proofOfDelivery: false, timestamp: telemetry.timestamp };
  const order = customerOrder({ ...snapshot, status: 'Delivered', photos: [landing, returning] }, receipt, now);
  assert.equal(order.photo?.proofOfDelivery, true);
  assert.include(order.photo!.url, 'landing.svg');
});

test('current stage progress follows live telemetry instead of jumping to complete', () => {
  const store = snapshot.store.location, drop = snapshot.order.dropOff;
  const along = (t: number) => ({ latitude: store.latitude + (drop.latitude - store.latitude) * t, longitude: store.longitude + (drop.longitude - store.longitude) * t });
  const delivering = (t: number) => customerOrder({ ...snapshot, status: 'PickedUp',
    telemetry: { ...telemetry, state: 'FlyingToCustomer', position: along(t), flightProgress: t } }, receipt, now).stageProgress!;
  assert.closeTo(delivering(.25), .25, .01);
  assert.closeTo(delivering(.75), .75, .01);
  const preparing = customerOrder({ ...snapshot, status: 'AwaitingFleet', telemetry: null, readyAt: new Date(now + 90000).toISOString() }, receipt, now);
  assert.equal(preparing.stage, 'Preparing');
  assert.closeTo(preparing.stageProgress!, .5, .01);
  const inbound = customerOrder(snapshot, receipt, now);
  assert.isAbove(inbound.stageProgress!, 0);
  assert.isBelow(inbound.stageProgress!, 1);
  assert.equal(customerOrder({ ...snapshot, status: 'Delivered' }, receipt, now).stageProgress, 1);
});

test('pickup and delivery bars advance during vertical phases using simulator progress only', () => {
  for (const state of ['FlyingToPickup', 'FlyingToCustomer'] as const) {
    const status = state === 'FlyingToPickup' ? 'Scheduled' : 'PickedUp';
    for (const [manoeuvre, progress] of [['VerticalClimb', .15], ['Cruise', .5], ['VerticalDescent', .85]] as const) {
      const update: OrderSnapshot = { ...snapshot, status, telemetry: {
        ...telemetry, state, manoeuvre, flightProgress: progress,
        // No horizontal movement during climb/descent: position cannot determine total leg progress.
        position: snapshot.store.location,
      } };
      assert.equal(customerOrder(update, receipt, now).stageProgress, progress);
      assert.equal(customerOrder(update, receipt, now + 1000).stageProgress, progress, 'browser time cannot invent flight progress');
    }
  }
  for (const fix of [
    { ...telemetry, flightProgress: null },
    { ...telemetry, flightProgress: undefined },
    { ...telemetry, orderId: 'OTHER' },
    { ...telemetry, droneId: 'OTHER' },
    { ...telemetry, timestamp: new Date(now - 31000).toISOString() },
    { ...telemetry, state: 'ReturningToPad' as const },
  ]) assert.equal(customerOrder({ ...snapshot, telemetry: fix }, receipt, now).stageProgress, 0);
  assert.equal(customerOrder({ ...snapshot, status: 'PickedUp' }, receipt, now).stageProgress, 0, 'previous pickup leg cannot fill delivery');
  assert.equal(customerOrder({ ...snapshot, telemetry: { ...telemetry, state: 'Loading', flightProgress: 1 } }, receipt, now).stageProgress, 1);
});

test('a random drop-off is valid and stays the same from receipt to tracking and map', async () => {
  assert.deepEqual(randomDropOff(() => 0), dropOffs[0]);
  assert.deepEqual(randomDropOff(() => .9999), dropOffs.at(-1));
  for (let i = 0; i < 50; i++) assert.ok(dropOffs.includes(randomDropOff()));

  const dropOff = randomDropOff(() => .5);
  let sent: { dropOff: { latitude: number; longitude: number } } | undefined;
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ orderId: 'FC-TEST' }), { status: 202 });
  }));
  try {
    const placed = await placeOrder([makeLine('latte')], 1, dropOff);
    assert.deepEqual(placed.dropOff, dropOff);
    const { x, y } = fromLonLat(sent!.dropOff.longitude, sent!.dropOff.latitude);
    assert.ok(Math.hypot(x - dropOff.x, y - dropOff.y) < .5, 'the server receives the receipt drop-off');

    const delivering = { ...snapshot, status: 'PickedUp' as const, order: { ...snapshot.order, dropOff: sent!.dropOff },
      telemetry: { ...telemetry, state: 'FlyingToCustomer' as const } };
    const order = customerOrder(delivering, placed, now);
    assert.equal(order.dropOff?.label, dropOff.label);
    assert.equal(order.tracking?.destination.label, dropOff.label);
    assert.equal(order.tracking?.target.label, dropOff.label);
    assert.ok(Math.hypot(order.tracking!.destination.x - dropOff.x, order.tracking!.destination.y - dropOff.y) < .5);
  } finally { vi.unstubAllGlobals(); }
});

test('arrival follows the live server estimate and is indeterminate while an operator flies the drone', () => {
  const flying = { ...snapshot, status: 'PickedUp' as const, telemetry: { ...telemetry, state: 'FlyingToCustomer' as const } };
  assert.equal(customerOrder(flying, receipt, now).etaSeconds, 120);
  const held = customerOrder({ ...flying, estimatedDelivery: null, arrivalIndeterminate: true }, receipt, now);
  assert.isTrue(held.arrivalIndeterminate);
  assert.isUndefined(held.etaSeconds);
  // Resumed later than the stale countdown would have said.
  const resumed = customerOrder({ ...flying, estimatedDelivery: new Date(now + 300000).toISOString(), arrivalIndeterminate: false }, receipt, now);
  assert.isFalse(resumed.arrivalIndeterminate);
  assert.equal(resumed.etaSeconds, 300);
  assert.isFalse(customerOrder({ ...flying, status: 'Failed', arrivalIndeterminate: true }, receipt, now).arrivalIndeterminate);
});
