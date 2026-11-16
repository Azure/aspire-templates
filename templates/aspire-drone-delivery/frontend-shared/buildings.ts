// OpenStreetMap building footprints for the drone camera, extruded in three.js.
// Footprints come from frontend-shared/osm-buildings.json, a one-off authoring-time extract
// (scripts/fetch-osm-buildings.mjs). Data © OpenStreetMap contributors, ODbL 1.0.
import * as THREE from 'three';

export type BuildingData = { buildings: number[][] };
export type Footprint = { ring: [number, number][]; heightMetres: number; tagged: boolean };

/** Untagged buildings copy their nearest tagged neighbour, capped so one tower can't raise a whole terrace. */
export const estimatedHeightCeilingMetres = 12;
/** Used when no tagged building lies within the search radius (or the extract has none). */
export const defaultHeightMetres = 7;
const searchRadius = 40; // Map units, about 170 m.
const cell = 10;

/** Decodes the delta-encoded extract into footprints in map units, with heights in metres. */
export function decodeBuildings(data: BuildingData): Footprint[] {
  const footprints = data.buildings.map(([height, ...coordinates]) => {
    const ring: [number, number][] = [];
    let x = 0, y = 0;
    for (let i = 0; i + 1 < coordinates.length; i += 2) {
      x = i ? x + coordinates[i] : coordinates[i];
      y = i ? y + coordinates[i + 1] : coordinates[i + 1];
      ring.push([x / 10, y / 10]);
    }
    return { ring, heightMetres: height / 10, tagged: height > 0 };
  });
  return resolveHeights(footprints);
}

const centroid = (ring: [number, number][]) => ring.reduce(([sx, sy], [x, y]) => [sx + x / ring.length, sy + y / ring.length], [0, 0]);

/** Fills missing heights from the nearest tagged building (by centroid), capped at the ceiling. */
export function resolveHeights(footprints: Footprint[]): Footprint[] {
  const grid = new Map<string, { x: number; y: number; height: number }[]>();
  for (const footprint of footprints) {
    if (!footprint.tagged) continue;
    const [x, y] = centroid(footprint.ring);
    const key = `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push({ x, y, height: footprint.heightMetres });
  }
  return footprints.map(footprint => {
    if (footprint.tagged) return footprint;
    const [x, y] = centroid(footprint.ring);
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
    let best: number | undefined, bestDistance = searchRadius;
    const reach = Math.ceil(searchRadius / cell);
    for (let gx = cx - reach; gx <= cx + reach; gx++) for (let gy = cy - reach; gy <= cy + reach; gy++) {
      for (const candidate of grid.get(`${gx},${gy}`) ?? []) {
        const distance = Math.hypot(candidate.x - x, candidate.y - y);
        if (distance <= bestDistance) { bestDistance = distance; best = candidate.height; }
      }
    }
    return { ...footprint, heightMetres: Math.min(best ?? defaultHeightMetres, estimatedHeightCeilingMetres) };
  });
}

const palette = ['#f2efe4', '#e6e1d2', '#ddd8ca', '#efe6d4', '#d5dccf'].map(color => new THREE.Color(color));

/**
 * Merges every footprint into one non-indexed geometry: a flat roof plus walls, in scene
 * coordinates (x = map x, z = map y, y = height in map units). Render with DoubleSide so
 * ring winding from OpenStreetMap doesn't matter.
 */
export function buildingGeometry(footprints: Footprint[], metresPerUnit: number) {
  const positions: number[] = [], colors: number[] = [], ids: number[] = [];
  const wall = new THREE.Color(), roof = new THREE.Color();
  footprints.forEach((footprint, index) => {
    const { ring } = footprint;
    if (ring.length < 3) return;
    const top = Math.max(.6, footprint.heightMetres / metresPerUnit);
    roof.copy(palette[index % palette.length]);
    wall.copy(roof).multiplyScalar(.82);
    const push = (x: number, y: number, z: number, color: THREE.Color) => { positions.push(x, y, z); colors.push(color.r, color.g, color.b); ids.push(index); };
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(ring.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
      for (const i of [a, b, c]) push(ring[i][0], top, ring[i][1], roof);
    }
    ring.forEach(([x0, z0], i) => {
      const [x1, z1] = ring[(i + 1) % ring.length];
      push(x0, 0, z0, wall); push(x1, 0, z1, wall); push(x1, top, z1, wall);
      push(x0, 0, z0, wall); push(x1, top, z1, wall); push(x0, top, z0, wall);
    });
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('building', new THREE.Float32BufferAttribute(ids, 1));
  geometry.computeVertexNormals();
  return geometry;
}

export const maxHiddenBuildings = 16;

const inside = (ring: [number, number][], x: number, y: number) => {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
};

/** Finds the footprint under a point, so a landed drone's camera isn't buried inside a real building. */
export function footprintIndex(footprints: Footprint[]) {
  const grid = new Map<string, number[]>();
  footprints.forEach(({ ring }, index) => {
    const xs = ring.map(([x]) => x), ys = ring.map(([, y]) => y);
    for (let gx = Math.floor(Math.min(...xs) / cell); gx <= Math.floor(Math.max(...xs) / cell); gx++)
      for (let gy = Math.floor(Math.min(...ys) / cell); gy <= Math.floor(Math.max(...ys) / cell); gy++)
        (grid.get(`${gx},${gy}`) ?? grid.set(`${gx},${gy}`, []).get(`${gx},${gy}`)!).push(index);
  });
  return (x: number, y: number) => (grid.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) ?? [])
    .find(index => inside(footprints[index].ring, x, y)) ?? -1;
}

/** Lambert material that discards the buildings listed in `hidden` (indices; -1 is unused). */
export function buildingMaterial() {
  const hidden = { value: new Array<number>(maxHiddenBuildings).fill(-1) };
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  material.onBeforeCompile = shader => {
    shader.uniforms.hiddenBuildings = hidden;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float building;\nvarying float vBuilding;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBuilding = building;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float vBuilding;\nuniform float hiddenBuildings[${maxHiddenBuildings}];`)
      .replace('void main() {', `void main() {\n  for (int i = 0; i < ${maxHiddenBuildings}; i++) if (abs(vBuilding - hiddenBuildings[i]) < .5) discard;`);
  };
  return { material, hidden: hidden.value };
}
