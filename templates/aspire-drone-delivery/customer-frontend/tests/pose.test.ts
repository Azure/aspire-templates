import { expect, test } from 'vitest';
import { PoseBuffer, turnBetween } from '../../frontend-shared/pose';
import type { CameraPose } from '../../frontend-shared/pose';

const start = Date.parse('2026-11-16T00:00:00Z');
const pose = (seconds: number, heading = 350): CameraPose => ({
  droneId: 'PIC-01', timestamp: new Date(start + seconds * 1000).toISOString(),
  position: { latitude: -37.83 + seconds / 10000, longitude: 144.96 },
  altitudeMetres: seconds * 4, heading, cameraPitchDegrees: -90 + seconds,
});
test('playout interpolates received position, altitude and camera pitch across the heading seam', () => {
  const buffer = new PoseBuffer();
  buffer.push(pose(0, 359)); buffer.push(pose(1, 1));
  const halfway = buffer.sample(start + 500)!;
  expect(halfway.heading).toBe(0);
  expect(halfway.altitudeMetres).toBe(2);
  expect(halfway.cameraPitchDegrees).toBe(-89.5);
  expect(halfway.position.latitude).toBeCloseTo(-37.82995);
  expect(turnBetween(1, 359, .5)).toBe(0);
  // Inserting the next snapshot cannot reset the already buffered trajectory.
  buffer.push(pose(2, 3));
  expect(buffer.sample(start + 500)).toEqual(halfway);
});
test('never extrapolates, ignores replayed snapshots and does not invent a path through a dropout', () => {
  const buffer = new PoseBuffer();
  expect(buffer.sample(start)).toBeUndefined();
  buffer.push(pose(0)); buffer.push(pose(1)); buffer.push(pose(0, 100));
  expect(buffer.sample(start - 500)).toEqual(pose(0));
  expect(buffer.sample(start + 4000)).toEqual(pose(1));
  buffer.push(pose(10));
  expect(buffer.sample(start + 7000)).toEqual(pose(1));
  expect(buffer.sample(start + 10000)).toEqual(pose(10));
  const other = { ...pose(11), droneId: 'DOP-01' };
  buffer.push(other);
  expect(buffer.sample(start)).toEqual(other);
});
