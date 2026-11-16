import { assert, test } from 'vitest';
import type { Telemetry } from '../src/api';
import { airborne, commandUnavailable, fleetMap } from '../src/model';
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
