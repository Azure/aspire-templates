import { describe, expect, it } from 'vitest';
import {
  airspaceFrom, clampInput, hover, inputFromKeys, lookFromPointer, ManualPredictor, speedOf, startState, step,
} from '../src/manualFlight';
import type { Airspace, FlightState } from '../src/manualFlight';
import { takeControlUnavailable } from '../src/model';
import type { Telemetry } from '../src/api';

const look = { cameraPitchDegrees: -30, cameraYawDegrees: 0 };
const origin = { position: { latitude: -37.8355, longitude: 144.964 }, altitudeMetres: 40, heading: 0 };
const fly = (state: FlightState, keys: string[], seconds: number, airspace?: Airspace) => {
  for (let t = 0; t < seconds; t += .1) state = step(state, inputFromKeys(new Set(keys), look), .1, 'Piccolo', airspace ?? { clearance: () => 0 });
  return state;
};

describe('manual flight keys', () => {
  it('maps WASD, Q/E and Space/Shift to sticks and cancels opposing keys', () => {
    expect(inputFromKeys(new Set(['KeyW', 'KeyD', 'Space', 'KeyE']), look)).toMatchObject({ forward: 1, strafe: 1, vertical: 1, yaw: 1 });
    expect(inputFromKeys(new Set(['KeyS', 'KeyA', 'ShiftRight', 'KeyQ']), look)).toMatchObject({ forward: -1, strafe: -1, vertical: -1, yaw: -1 });
    expect(inputFromKeys(new Set(['KeyW', 'KeyS', 'Space', 'ShiftLeft']), look)).toMatchObject({ forward: 0, vertical: 0 });
    expect(inputFromKeys(new Set(), look)).toEqual(hover(look));
  });

  it('bounds the mouse look from slightly above the horizon to straight down', () => {
    expect(lookFromPointer(.5, 0)).toEqual({ cameraYawDegrees: 0, cameraPitchDegrees: 10 });
    expect(lookFromPointer(0, 1)).toEqual({ cameraYawDegrees: -90, cameraPitchDegrees: -90 });
    expect(lookFromPointer(4, -3)).toEqual({ cameraYawDegrees: 90, cameraPitchDegrees: 10 });
    expect(clampInput({ ...hover(), forward: Number.NaN, yaw: 9, cameraPitchDegrees: Infinity })).toMatchObject({ forward: 0, yaw: 1, cameraPitchDegrees: -30 });
  });
});

describe('manual flight model', () => {
  it('accelerates, pitches into the move and brakes to a hover when released', () => {
    let state = fly(startState(origin), ['KeyW'], 1);
    expect(speedOf(state)).toBeCloseTo(3, 0);
    expect(state.pitch).toBeLessThan(-5);
    expect(state.latitude).toBeGreaterThan(origin.position.latitude);
    state = fly(state, [], 3);
    expect(speedOf(state)).toBeLessThan(.01);
  });

  it('ignores zero-length frames instead of producing NaN', () => {
    const moving = fly(startState(origin), ['KeyW'], 1);
    const same = step(moving, inputFromKeys(new Set(['KeyW']), look), 0, 'Piccolo', { clearance: () => 0 });
    expect(same).toBe(moving);
    expect(Number.isFinite(step(moving, hover(), .016, 'Piccolo', { clearance: () => 0 }).pitch)).toBe(true);
  });

  it('banks against momentum when yawing hard while moving and wraps heading', () => {
    let state = fly(startState({ ...origin, heading: 350 }), ['KeyW'], 4);
    state = fly(state, ['KeyW', 'KeyE'], .6);
    expect(state.heading).toBeLessThan(90);
    expect(Math.abs(state.roll)).toBeGreaterThan(2);
  });

  it('stops at buildings, holds the floor and ceiling, and climbs over envelopes', () => {
    const wall: Airspace = { clearance: (latitude) => latitude > -37.8352 ? 60 : 0 };
    let state = fly(startState(origin), ['KeyW'], 12, wall);
    expect(state.latitude).toBeLessThanOrEqual(-37.8352);
    state = fly(state, ['ShiftLeft'], 20, wall);
    expect(state.altitude).toBeCloseTo(20, 5);
    state = fly(state, ['Space', 'KeyW'], 20, wall);
    expect(state.altitude).toBeGreaterThan(60);
    expect(state.latitude).toBeGreaterThan(-37.8352);
    expect(fly(state, ['Space'], 40, wall).altitude).toBeLessThanOrEqual(120);
  });

  it('uses conservative building envelopes from the shared footprints', () => {
    const x = (144.964 - 144.93232) / .048 * 1000, y = (-37.81797 + 37.8355) / .0295 * 650;
    const square = [[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1]] as [number, number][];
    const airspace = airspaceFrom([{ ring: square, heightMetres: 30, tagged: true }, { ring: square, heightMetres: 4, tagged: false }]);
    expect(airspace.clearance(-37.8355, 144.964)).toBe(36);
    expect(airspace.clearance(-37.84, 144.97)).toBe(0);
  });
});

describe('prediction reconciliation', () => {
  it('compares acknowledged telemetry with the prediction at the matching time and snaps on large errors', () => {
    const predictor = new ManualPredictor(startState(origin), 'Piccolo');
    predictor.recordSend(1, 0);
    for (let at = 100; at <= 2000; at += 100) predictor.advance(inputFromKeys(new Set(['KeyW']), look), .1, at);
    const then = predictor.pose('P-1', 0);
    const small = predictor.reconcile({ ...then, droneId: 'P-1', manual: { sessionId: 's', status: 'Active', acknowledged: 1, appliedSeconds: 2 } });
    expect(small).not.toBeNull();
    expect(small!).toBeLessThan(.5);
    expect(predictor.reconcile({ ...then, droneId: 'P-1', manual: { sessionId: 's', status: 'Active', acknowledged: 1, appliedSeconds: 2 } })).toBeNull();
    const far = { latitude: then.position.latitude + .001, longitude: then.position.longitude };
    expect(predictor.reconcile({ ...then, position: far, droneId: 'P-1', manual: { sessionId: 's', status: 'Active', acknowledged: 1, appliedSeconds: 2.1 } })!).toBeGreaterThan(30);
    expect(predictor.state.latitude).toBe(far.latitude);
  });
});

describe('take control availability', () => {
  const drone = (patch: Partial<Telemetry>): Telemetry => ({
    droneId: 'P-1', class: 'Piccolo', sequence: 1, timestamp: new Date().toISOString(), position: origin.position, homePad: origin.position,
    altitudeMetres: 40, heading: 0, batteryPercent: 80, state: 'FlyingToCustomer', manoeuvre: 'Cruise', orderId: 'o', queuedMissions: 0,
    cameraPitchDegrees: -30, carryingPackage: true, control: null, ...patch,
  });
  it('requires an airborne delivery or return flight that nobody else is flying', () => {
    expect(takeControlUnavailable(drone({}))).toBe('');
    expect(takeControlUnavailable(drone({ manoeuvre: 'OnTheGround' }))).toMatch(/airborne/);
    expect(takeControlUnavailable(drone({ state: 'FlyingToWaste' }))).toMatch(/airborne/);
    expect(takeControlUnavailable(drone({ control: { commandId: 'c', command: 'ReturnToBase', status: 'Executing', message: '' } }))).toMatch(/command/);
    const manual = { sessionId: 'other', status: 'Active' as const, acknowledged: 1, appliedSeconds: 0, linkLostSeconds: 0, message: '' };
    expect(takeControlUnavailable(drone({ manual }))).toMatch(/Another operator/);
    expect(takeControlUnavailable(drone({ manual }), 'other')).toBe('');
  });
});
