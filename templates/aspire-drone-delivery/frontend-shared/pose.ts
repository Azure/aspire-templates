export type FlightWaypoint = { position: { latitude: number; longitude: number }; altitudeMetres: number };
export type CameraPose = {
  droneId: string; timestamp: string;
  position: { latitude: number; longitude: number };
  altitudeMetres: number; heading: number; cameraPitchDegrees: number;
  pitchDegrees?: number; rollDegrees?: number;
  plannedRoute?: FlightWaypoint[] | null;
};

export function turnBetween(from: number, to: number, fraction: number) {
  return (from + ((to - from + 540) % 360 - 180) * fraction + 360) % 360;
}

/** A short playout buffer, not a local flight simulator: never predicts beyond received telemetry. */
export class PoseBuffer {
  private poses: CameraPose[] = [];
  push(pose: CameraPose) {
    if (this.poses[0]?.droneId !== pose.droneId) this.poses = [];
    if (!Number.isFinite(Date.parse(pose.timestamp)) ||
      ![pose.position.latitude, pose.position.longitude, pose.altitudeMetres, pose.heading, pose.cameraPitchDegrees,
        pose.pitchDegrees ?? 0, pose.rollDegrees ?? 0].every(Number.isFinite)) return;
    if (this.poses.length && Date.parse(pose.timestamp) <= Date.parse(this.poses.at(-1)!.timestamp)) return;
    this.poses = [...this.poses.slice(-11), pose];
  }
  sample(at: number): CameraPose | undefined {
    const first = this.poses[0], last = this.poses.at(-1);
    if (!first || !last) return;
    if (at <= Date.parse(first.timestamp)) return first;
    const after = this.poses.findIndex(pose => Date.parse(pose.timestamp) >= at);
    if (after < 0) return last;
    const a = this.poses[after - 1], b = this.poses[after];
    const gap = Date.parse(b.timestamp) - Date.parse(a.timestamp);
    // Freeze through missing telemetry, then adopt the recovered fix. Do not invent a path across a dropout.
    if (gap > 5000) return at < Date.parse(b.timestamp) ? a : b;
    const f = (at - Date.parse(a.timestamp)) / gap;
    const mix = (x: number, y: number) => x + (y - x) * f;
    return {
      droneId: b.droneId, timestamp: new Date(at).toISOString(),
      position: { latitude: mix(a.position.latitude, b.position.latitude), longitude: mix(a.position.longitude, b.position.longitude) },
      altitudeMetres: mix(a.altitudeMetres, b.altitudeMetres),
      heading: turnBetween(a.heading, b.heading, f), cameraPitchDegrees: mix(a.cameraPitchDegrees, b.cameraPitchDegrees),
      pitchDegrees: mix(a.pitchDegrees ?? 0, b.pitchDegrees ?? 0),
      rollDegrees: mix(a.rollDegrees ?? 0, b.rollDegrees ?? 0),
    };
  }
}
