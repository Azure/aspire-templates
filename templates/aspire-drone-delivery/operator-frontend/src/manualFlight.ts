// Client-side prediction of the simulator's manual flight model (DroneDelivery.Domain/ManualFlight.cs).
// The simulator is authoritative; this mirrors it so the controlling operator's camera responds instantly,
// then reconciles against acknowledged telemetry.
import type { Footprint } from '../../frontend-shared/buildings';
import type { CameraPose } from '../../frontend-shared/pose';

/** The operator's requested camera: gimbal aim, optical zoom (1–8×) and focus distance in metres (0 = autofocus). */
export type Look = { cameraPitchDegrees: number; cameraYawDegrees: number; cameraZoom: number; cameraFocusMetres: number };
export type ManualInput = { forward: number; strafe: number; vertical: number; yaw: number } & Look;
export type DroneClass = 'Piccolo' | 'Doppio' | 'Abbondante';
export const specs: Record<DroneClass, { cruise: number; vertical: number }> = {
  Piccolo: { cruise: 16, vertical: 4 }, Doppio: { cruise: 14, vertical: 3.5 }, Abbondante: { cruise: 12, vertical: 3 },
};
export const stepSeconds = .1;
const horizontalAcceleration = 3, verticalAcceleration = 2, maxYawRate = 60, yawAcceleration = 180, strafeFraction = .6;
export const maxTilt = 14;
export const cameraPitchRange = [-90, 10] as const;
export const cameraYawLimit = 90;
/** Mirrors ManualFlight: the gimbal slews at most this fast so aim changes stay smooth. */
export const cameraSlewDegreesPerSecond = 45;
export const maxZoom = 8, zoomPerSecond = 2, focusRange = [5, 400] as const;
/** The feed's vertical field of view at 1× zoom (DroneCam). */
export const baseFieldOfView = 62;
export const floorMetres = 20, ceilingMetres = 120, clearanceMetres = 6;
const metresPerDegree = 6_371_000 * Math.PI / 180;
const area = { south: -37.845, north: -37.826, west: 144.950, east: 144.978 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? value : fallback;
const approach = (value: number, target: number, step: number) => value < target ? Math.min(target, value + step) : Math.max(target, value - step);
const wrap = (degrees: number) => (degrees % 360 + 360) % 360;

export const hover = (look?: Partial<Look>): ManualInput => ({
  forward: 0, strafe: 0, vertical: 0, yaw: 0, cameraPitchDegrees: look?.cameraPitchDegrees ?? -30, cameraYawDegrees: look?.cameraYawDegrees ?? 0,
  cameraZoom: look?.cameraZoom ?? 1, cameraFocusMetres: look?.cameraFocusMetres ?? 0,
});

export function clampInput(input: ManualInput): ManualInput {
  return {
    forward: clamp(finite(input.forward), -1, 1), strafe: clamp(finite(input.strafe), -1, 1),
    vertical: clamp(finite(input.vertical), -1, 1), yaw: clamp(finite(input.yaw), -1, 1),
    cameraPitchDegrees: clamp(finite(input.cameraPitchDegrees, -30), ...cameraPitchRange),
    cameraYawDegrees: clamp(finite(input.cameraYawDegrees), -cameraYawLimit, cameraYawLimit),
    cameraZoom: clamp(finite(input.cameraZoom, 1), 1, maxZoom),
    cameraFocusMetres: !(finite(input.cameraFocusMetres) > 0) ? 0 : clamp(input.cameraFocusMetres, ...focusRange),
  };
}

/** Keys held → stick positions. W/S forward-back, A/D strafe, Space/Z up-down, Q/E yaw. */
export const controlKeys = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'Space', 'KeyZ']);
export function inputFromKeys(keys: ReadonlySet<string>, look: Look): ManualInput {
  const axis = (positive: boolean, negative: boolean) => (positive ? 1 : 0) - (negative ? 1 : 0);
  return clampInput({
    forward: axis(keys.has('KeyW'), keys.has('KeyS')), strafe: axis(keys.has('KeyD'), keys.has('KeyA')),
    vertical: axis(keys.has('Space'), keys.has('KeyZ')), yaw: axis(keys.has('KeyE'), keys.has('KeyQ')),
    ...look,
  });
}

/** Cursor position over the feed → gimbal: left/right ±90°, top slightly above the horizon, bottom straight down. */
export function lookFromPointer(x: number, y: number) {
  return {
    cameraYawDegrees: clamp((clamp(x, 0, 1) * 2 - 1) * cameraYawLimit, -cameraYawLimit, cameraYawLimit),
    cameraPitchDegrees: clamp(cameraPitchRange[1] - clamp(y, 0, 1) * (cameraPitchRange[1] - cameraPitchRange[0]), ...cameraPitchRange),
  };
}

/** Mouse wheel → zoom; each notch (~100 px) is about 15%. Scrolling up zooms in. */
export function zoomBy(zoom: number, deltaPixels: number) {
  return clamp(finite(zoom, 1) * Math.exp(-deltaPixels * .0015), 1, maxZoom);
}

/** Shift+wheel → focus distance. Starts from the current subject when on autofocus; scrolling up focuses nearer. */
export function focusBy(focus: number, subjectMetres: number, deltaPixels: number) {
  const from = focus > 0 ? focus : clamp(finite(subjectMetres, 60), ...focusRange);
  return clamp(from * Math.exp(deltaPixels * .002), ...focusRange);
}

/** Where the requested aim sits in the feed, as a fraction of its width and height from the top-left (0.5, 0.5 is the actual aim). */
export function aimOffset(actual: { pitch: number; yaw: number }, desired: { pitch: number; yaw: number }, zoom: number, aspect: number) {
  const half = Math.tan(baseFieldOfView / clamp(finite(zoom, 1), 1, maxZoom) / 2 * Math.PI / 180);
  const x = Math.tan(clamp(desired.yaw - actual.yaw, -89, 89) * Math.PI / 180) / (half * Math.max(.1, aspect));
  const y = Math.tan(clamp(desired.pitch - actual.pitch, -89, 89) * Math.PI / 180) / half;
  return { x: clamp(.5 + x / 2, 0, 1), y: clamp(.5 - y / 2, 0, 1), inView: Math.abs(x) <= 1 && Math.abs(y) <= 1 };
}

export type Airspace = { clearance(latitude: number, longitude: number): number };
export const openAirspace: Airspace = { clearance: () => 0 };

/** The simulator's conservative envelopes: footprint bounding boxes plus 6 m, untagged buildings treated as 12 m. */
export function airspaceFrom(footprints: readonly Footprint[]): Airspace {
  const cell = 60, grid = new Map<string, { x0: number; y0: number; x1: number; y1: number; required: number }[]>();
  for (const footprint of footprints) {
    const xs = footprint.ring.map(([x]) => x * 4.2), ys = footprint.ring.map(([, y]) => y * 4.2);
    const envelope = {
      x0: Math.min(...xs) - clearanceMetres, y0: Math.min(...ys) - clearanceMetres,
      x1: Math.max(...xs) + clearanceMetres, y1: Math.max(...ys) + clearanceMetres,
      required: Math.max(.6 * 4.2, footprint.tagged ? footprint.heightMetres : 12) + clearanceMetres,
    };
    for (let gx = Math.floor(envelope.x0 / cell); gx <= Math.floor(envelope.x1 / cell); gx++)
      for (let gy = Math.floor(envelope.y0 / cell); gy <= Math.floor(envelope.y1 / cell); gy++) {
        const key = `${gx},${gy}`;
        (grid.get(key) ?? grid.set(key, []).get(key)!).push(envelope);
      }
  }
  return {
    clearance(latitude, longitude) {
      const x = (longitude - 144.93232) / .048 * 1000 * 4.2, y = (-37.81797 - latitude) / .0295 * 650 * 4.2;
      let required = 0;
      for (const envelope of grid.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) ?? [])
        if (x >= envelope.x0 && x <= envelope.x1 && y >= envelope.y0 && y <= envelope.y1) required = Math.max(required, envelope.required);
      return required;
    },
  };
}

export type FlightState = {
  latitude: number; longitude: number; altitude: number; heading: number;
  velocityEast: number; velocityNorth: number; verticalSpeed: number; yawRate: number;
  pitch: number; roll: number; cameraPitch: number; cameraYaw: number; cameraZoom: number; cameraFocus: number;
};

type StartPose = {
  position: { latitude: number; longitude: number }; altitudeMetres: number; heading: number;
  cameraPitchDegrees?: number; cameraYawDegrees?: number; cameraZoom?: number; cameraFocusMetres?: number;
};

/** Takes over from the drone's current pose and camera, so the pilot view opens exactly where the operations feed was looking. */
export function startState(pose: StartPose): FlightState {
  const camera = clampInput(hover({ cameraPitchDegrees: pose.cameraPitchDegrees, cameraYawDegrees: pose.cameraYawDegrees,
    cameraZoom: pose.cameraZoom, cameraFocusMetres: pose.cameraFocusMetres }));
  return {
    latitude: pose.position.latitude, longitude: pose.position.longitude, altitude: pose.altitudeMetres, heading: wrap(pose.heading),
    velocityEast: 0, velocityNorth: 0, verticalSpeed: 0, yawRate: 0, pitch: 0, roll: 0,
    cameraPitch: camera.cameraPitchDegrees, cameraYaw: camera.cameraYawDegrees, cameraZoom: camera.cameraZoom, cameraFocus: camera.cameraFocusMetres,
  };
}

/** The requested camera that holds the drone's current one. */
export const lookOf = (state: FlightState): Look =>
  ({ cameraPitchDegrees: state.cameraPitch, cameraYawDegrees: state.cameraYaw, cameraZoom: state.cameraZoom, cameraFocusMetres: state.cameraFocus });

const inside = (latitude: number, longitude: number) =>
  latitude >= area.south && latitude <= area.north && longitude >= area.west && longitude <= area.east;

/** One step of the manual flight model; identical rules to the simulator's ManualFlight.Step. */
export function step(state: FlightState, raw: ManualInput, seconds: number, droneClass: DroneClass, airspace: Airspace): FlightState {
  // Animation frames can share a timestamp; a zero step would divide by zero in the tilt model.
  if (!(seconds > 0)) return state;
  const input = clampInput(raw), spec = specs[droneClass];
  const s = {
    ...state,
    cameraPitch: approach(state.cameraPitch, input.cameraPitchDegrees, cameraSlewDegreesPerSecond * seconds),
    cameraYaw: approach(state.cameraYaw, input.cameraYawDegrees, cameraSlewDegreesPerSecond * seconds),
    cameraZoom: approach(state.cameraZoom, input.cameraZoom, zoomPerSecond * seconds),
    cameraFocus: input.cameraFocusMetres,
  };
  s.yawRate = approach(s.yawRate, input.yaw * maxYawRate, yawAcceleration * seconds);
  s.heading = wrap(s.heading + s.yawRate * seconds);
  const h = s.heading * Math.PI / 180;
  const [forwardEast, forwardNorth, rightEast, rightNorth] = [Math.sin(h), Math.cos(h), Math.cos(h), -Math.sin(h)];
  const forward = input.forward * spec.cruise, strafe = input.strafe * spec.cruise * strafeFraction;
  let deltaEast = forward * forwardEast + strafe * rightEast - s.velocityEast;
  let deltaNorth = forward * forwardNorth + strafe * rightNorth - s.velocityNorth;
  const delta = Math.hypot(deltaEast, deltaNorth), limit = horizontalAcceleration * seconds;
  if (delta > limit) { deltaEast = deltaEast / delta * limit; deltaNorth = deltaNorth / delta * limit; }
  s.velocityEast += deltaEast; s.velocityNorth += deltaNorth;
  const accelForward = (deltaEast * forwardEast + deltaNorth * forwardNorth) / seconds;
  const accelRight = (deltaEast * rightEast + deltaNorth * rightNorth) / seconds;
  const smoothing = clamp(seconds / .35, 0, 1);
  s.pitch += (clamp(-accelForward / horizontalAcceleration * maxTilt, -maxTilt, maxTilt) - s.pitch) * smoothing;
  s.roll += (clamp(accelRight / horizontalAcceleration * maxTilt, -maxTilt, maxTilt) - s.roll) * smoothing;

  const offset = (east: number, north: number) => [
    s.latitude + north / metresPerDegree,
    s.longitude + east / (metresPerDegree * Math.cos(s.latitude * Math.PI / 180)),
  ] as const;
  const canOccupy = ([latitude, longitude]: readonly [number, number]) =>
    inside(latitude, longitude) && airspace.clearance(latitude, longitude) <= s.altitude + 1e-6;
  let next = offset(s.velocityEast * seconds, s.velocityNorth * seconds);
  if (!canOccupy(next)) {
    const eastOnly = offset(s.velocityEast * seconds, 0), northOnly = offset(0, s.velocityNorth * seconds);
    if (canOccupy(eastOnly)) { next = eastOnly; s.velocityNorth = 0; }
    else if (canOccupy(northOnly)) { next = northOnly; s.velocityEast = 0; }
    else { next = [s.latitude, s.longitude]; s.velocityEast = s.velocityNorth = 0; }
  }
  [s.latitude, s.longitude] = next;

  s.verticalSpeed = approach(s.verticalSpeed, input.vertical * spec.vertical, verticalAcceleration * seconds);
  let altitude = s.altitude + s.verticalSpeed * seconds;
  const floor = Math.min(s.altitude, Math.max(floorMetres, airspace.clearance(s.latitude, s.longitude)));
  const ceiling = Math.max(s.altitude, ceilingMetres);
  if (altitude < floor || altitude > ceiling) { altitude = clamp(altitude, floor, ceiling); s.verticalSpeed = 0; }
  s.altitude = altitude;
  return s;
}

export const speedOf = (state: FlightState) => Math.hypot(state.velocityEast, state.velocityNorth);

export type ManualTelemetry = {
  droneId: string; timestamp: string; position: { latitude: number; longitude: number }; altitudeMetres: number; heading: number;
  manual?: { sessionId: string; status: string; acknowledged: number; appliedSeconds: number } | null;
};

/**
 * Predicts the controlled drone locally and blends towards authoritative telemetry. Each telemetry reading says which
 * input it had applied and for how long, so it is compared with the prediction at the matching local time.
 */
export class ManualPredictor {
  state: FlightState;
  private history: { at: number; state: FlightState }[] = [];
  private sent = new Map<number, number>();
  private correction = { north: 0, east: 0, altitude: 0, heading: 0 };
  private lastSequence = -1;
  constructor(start: FlightState, private droneClass: DroneClass, public airspace: Airspace = openAirspace) { this.state = start; }

  recordSend(sequence: number, at: number) {
    this.sent.set(sequence, at);
    for (const key of this.sent.keys()) if (key < sequence - 200) this.sent.delete(key);
  }

  advance(input: ManualInput, seconds: number, at: number) {
    // Feed corrections in gradually so the view never jumps for small disagreements.
    const share = clamp(seconds * 3, 0, 1), c = this.correction;
    const parts = { north: c.north * share, east: c.east * share, altitude: c.altitude * share, heading: c.heading * share };
    c.north -= parts.north; c.east -= parts.east; c.altitude -= parts.altitude; c.heading -= parts.heading;
    const s = this.state;
    this.state = step({
      ...s, latitude: s.latitude + parts.north / metresPerDegree,
      longitude: s.longitude + parts.east / (metresPerDegree * Math.cos(s.latitude * Math.PI / 180)),
      altitude: s.altitude + parts.altitude, heading: wrap(s.heading + parts.heading),
    }, input, seconds, this.droneClass, this.airspace);
    this.history.push({ at, state: this.state });
    while (this.history.length && this.history[0].at < at - 10000) this.history.shift();
  }

  /** Returns the position error in metres that was found (and is now being corrected), or null when not comparable. */
  reconcile(reading: ManualTelemetry): number | null {
    const manual = reading.manual;
    if (!manual || manual.acknowledged <= 0 || reading.timestamp === undefined) return null;
    const sentAt = this.sent.get(manual.acknowledged);
    const key = manual.acknowledged * 1e6 + Math.round(manual.appliedSeconds * 1000);
    if (sentAt === undefined || key <= this.lastSequence) return null;
    this.lastSequence = key;
    const at = sentAt + manual.appliedSeconds * 1000;
    const then = this.history.find(entry => entry.at >= at)?.state ?? this.history.at(-1)?.state;
    if (!then) return null;
    const north = (reading.position.latitude - then.latitude) * metresPerDegree;
    const east = (reading.position.longitude - then.longitude) * metresPerDegree * Math.cos(then.latitude * Math.PI / 180);
    const altitude = reading.altitudeMetres - then.altitude;
    const heading = ((reading.heading - then.heading + 540) % 360) - 180;
    const error = Math.hypot(north, east, altitude);
    if (error > 30) {
      // Too far apart to blend (e.g. a blocked move the prediction missed): adopt the authoritative pose.
      this.state = { ...this.state, latitude: reading.position.latitude, longitude: reading.position.longitude,
        altitude: reading.altitudeMetres, heading: wrap(reading.heading) };
      this.correction = { north: 0, east: 0, altitude: 0, heading: 0 };
    } else this.correction = { north, east, altitude, heading };
    return error;
  }

  pose(droneId: string, at: number): CameraPose {
    const s = this.state;
    return {
      droneId, timestamp: new Date(at).toISOString(), position: { latitude: s.latitude, longitude: s.longitude },
      altitudeMetres: s.altitude, heading: s.heading, cameraPitchDegrees: s.cameraPitch, cameraYawDegrees: s.cameraYaw,
      pitchDegrees: s.pitch, rollDegrees: s.roll, cameraZoom: s.cameraZoom, cameraFocusMetres: s.cameraFocus,
    };
  }
}
