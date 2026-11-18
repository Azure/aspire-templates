import { assert, test } from 'vitest';
import type { Telemetry } from '../src/api';
import { airborne, commandUnavailable, filterFleet, fleetMap } from '../src/model';
import { toLonLat } from '../src/mapGeometry';

const drone: Telemetry = {
  droneId: 'ABB-02', class: 'Abbondante', sequence: 1, timestamp: new Date().toISOString(),
  position: { latitude: -37.838, longitude: 144.967 }, homePad: { latitude: -37.842, longitude: 144.972 },
  altitudeMetres: 60, heading: 0, batteryPercent: 75, state: 'FlyingToPickup', manoeuvre: 'Cruise',
  orderId: 'FC-TEST', queuedMissions: 2,
  cameraPitchDegrees: -30, carryingPackage: false, control: null,
};
test('operations map shows each reported drone without adding illustrative loops', () => {
  assert.deepEqual(fleetMap([]), []);
  const result = fleetMap([drone, { ...drone, droneId: 'PIC-01' }]);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(flight => flight.id), ['ABB-02', 'PIC-01']);
  const [longitude, latitude] = toLonLat(result[0].x, result[0].y);
  assert.approximately(longitude, drone.position.longitude, 1e-8);
  assert.approximately(latitude, drone.position.latitude, 1e-8);
});
test('airborne count follows manoeuvres, not a scheduled order or hard-coded fleet size', () => {
  assert.equal(airborne(drone), true);
  assert.equal(airborne({ ...drone, manoeuvre: 'OnTheGround', state: 'Loading' }), false);
});

test('roster search matches drone names without case or surrounding whitespace and can be cleared', () => {
  const fleet = [drone, { ...drone, droneId: 'PIC-01' }, { ...drone, droneId: 'PIC-02' }];
  assert.deepEqual(filterFleet(fleet, ' pic- ').map(item => item.droneId), ['PIC-01', 'PIC-02']);
  assert.deepEqual(filterFleet(fleet, '02').map(item => item.droneId), ['ABB-02', 'PIC-02']);
  assert.deepEqual(filterFleet(fleet, 'PIC-01'), [fleet[1]]);
  assert.deepEqual(filterFleet(fleet, 'unknown'), []);
  assert.deepEqual(filterFleet(fleet, ''), fleet);
  assert.deepEqual(filterFleet(fleet, '   '), fleet);
});

test('the fleet map preserves all simulator route bends and does not invent a path for parked drones', () => {
  const plannedRoute = [drone.homePad, drone.position, { latitude: -37.8318, longitude: 144.958 }]
    .map(position => ({ position, altitudeMetres: 60 }));
  const [flight, parked] = fleetMap([{ ...drone, plannedRoute }, { ...drone, droneId: 'PIC-01', plannedRoute: null }]);
  assert.equal(flight.path?.length, 3);
  flight.path!.forEach((point, index) => {
    const [lon, lat] = toLonLat(point.x, point.y);
    assert.approximately(lon, plannedRoute[index].position.longitude, 1e-8);
    assert.approximately(lat, plannedRoute[index].position.latitude, 1e-8);
  });
  assert.isUndefined(parked.path);
});

test('controls require the right payload and recovery state and serialize ongoing actions', () => {
  const current = { ...drone, timestamp: new Date().toISOString() };
  assert.notEqual(commandUnavailable(current, 'DiscardPackage'), '');
  assert.equal(commandUnavailable({ ...current, carryingPackage: true }, 'DiscardPackage'), '');
  assert.notEqual(commandUnavailable(current, 'Reactivate'), '');
  assert.equal(commandUnavailable({ ...current, state: 'Grounded' }, 'Reactivate'), '');
  assert.notEqual(commandUnavailable({ ...current, state: 'Grounded' }, 'ReturnToBase'), '');
  assert.notEqual(commandUnavailable({ ...current, control: {
    commandId: 'test', command: 'ReturnToBase', status: 'Executing', message: 'Returning',
  } }, 'EmergencyLanding'), '');
  assert.notEqual(commandUnavailable({ ...current, timestamp: new Date(0).toISOString() }, 'ReturnToBase'), '');
});
