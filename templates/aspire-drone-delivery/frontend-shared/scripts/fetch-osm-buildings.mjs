// Authoring-time extract of OpenStreetMap building footprints for the drone camera.
// Run once when the demo area changes: `node frontend-shared/scripts/fetch-osm-buildings.mjs`.
// The app never queries Overpass at runtime; it bundles the compact output instead.
// Data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
import { writeFile } from 'node:fs/promises';

// Must match the camera ground region in DroneCam.tsx and the projection in mapGeometry.ts.
const region = { x: 280, y: 100, width: 720, height: 550 };
const toLonLat = (x, y) => [144.93232 + x / 1000 * .048, -37.81797 - y / 650 * .0295];
const fromLonLat = (lon, lat) => [(lon - 144.93232) / .048 * 1000, (-37.81797 - lat) / .0295 * 650];
const quantum = 10; // Coordinates are stored in tenths of a map unit (about 0.45 m).
const minimumArea = 1.2; // Square map units (about 25 m²); smaller sheds are dropped.
const tolerance = .12; // Douglas-Peucker tolerance in map units (about 0.55 m).

const [west, north] = toLonLat(region.x, region.y);
const [east, south] = toLonLat(region.x + region.width, region.y + region.height);
const query = `[out:json][timeout:90];way["building"](${south},${west},${north},${east});out tags geom;`;
const response = await fetch(process.env.OVERPASS_URL ?? 'https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'aspire-templates forthcoffee-drones building extract' },
  body: new URLSearchParams({ data: query }),
});
if (!response.ok) throw new Error(`Overpass request failed (${response.status}).`);
const { elements } = await response.json();

const area = points => points.reduce((sum, [x, y], i) => {
  const [nx, ny] = points[(i + 1) % points.length];
  return sum + x * ny - nx * y;
}, 0) / 2;

function simplify(points) {
  if (points.length <= 4) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a], [bx, by] = points[b];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let worst = -1, distance = 0;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      const d = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (d > distance) { distance = d; worst = i; }
    }
    if (distance > tolerance) { keep[worst] = true; stack.push([a, worst], [worst, b]); }
  }
  const result = points.filter((_, i) => keep[i]);
  return result.length >= 4 ? result : points;
}

// Explicit metres, or levels at 3.2 m each; anything else is left for the client to estimate.
function taggedHeight(tags) {
  const metres = Number.parseFloat(String(tags.height ?? '').replace(/m$/, ''));
  if (Number.isFinite(metres) && metres > 0) return metres;
  const levels = Number.parseFloat(tags['building:levels'] ?? '');
  if (Number.isFinite(levels) && levels > 0) return levels * 3.2;
  return 0;
}

const buildings = [];
for (const element of elements) {
  if (element.type !== 'way' || !element.geometry?.length) continue;
  let ring = element.geometry.map(({ lon, lat }) => fromLonLat(lon, lat));
  if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring.pop();
  if (ring.length < 3 || Math.abs(area(ring)) < minimumArea) continue;
  ring = simplify([...ring, ring[0]]).slice(0, -1);
  const quantised = ring.map(([x, y]) => [Math.round(x * quantum), Math.round(y * quantum)]);
  // Delta-encode: first vertex absolute, the rest relative to the previous vertex.
  const flat = [Math.round(taggedHeight(element.tags ?? {}) * 10)];
  quantised.forEach(([x, y], i) => flat.push(i ? x - quantised[i - 1][0] : x, i ? y - quantised[i - 1][1] : y));
  buildings.push(flat);
}

const output = {
  attribution: '© OpenStreetMap contributors',
  license: 'ODbL 1.0 https://opendatacommons.org/licenses/odbl/1-0/',
  source: 'https://www.openstreetmap.org/copyright',
  extracted: new Date().toISOString().slice(0, 10),
  format: 'Each building is [tagged height in decimetres or 0, x0, y0, dx1, dy1, ...] in tenths of a map unit.',
  buildings,
};
const target = new URL('../osm-buildings.json', import.meta.url);
await writeFile(target, JSON.stringify(output));
console.log(`Wrote ${buildings.length} of ${elements.length} buildings (${buildings.filter(b => b[0]).length} with tagged heights) to ${target.pathname}`);
