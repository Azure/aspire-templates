import { describe, expect, it } from 'vitest';
import { buildingGeometry, decodeBuildings, defaultHeightMetres, estimatedHeightCeilingMetres, resolveHeights } from '../../frontend-shared/buildings';
import type { Footprint } from '../../frontend-shared/buildings';
import data from '../../frontend-shared/osm-buildings.json';

const square = (x: number, y: number, heightMetres = 0): Footprint =>
  ({ ring: [[x, y], [x + 2, y], [x + 2, y + 2], [x, y + 2]], heightMetres, tagged: heightMetres > 0 });

describe('OpenStreetMap camera buildings', () => {
  it('decodes delta-encoded footprints and keeps tagged heights', () => {
    const [building] = decodeBuildings({ buildings: [[95, 5000, 3000, 20, 0, 0, 20, -20, 0]] });
    expect(building.ring).toEqual([[500, 300], [502, 300], [502, 302], [500, 302]]);
    expect(building).toMatchObject({ heightMetres: 9.5, tagged: true });
  });

  it('gives untagged buildings the nearest tagged height, capped at the ceiling', () => {
    const [, near, , capped, lonely] = resolveHeights([
      square(0, 0, 6), square(5, 0), square(30, 0, 40), square(33, 0), square(400, 400),
    ]);
    expect(near.heightMetres).toBe(6);
    expect(capped.heightMetres).toBe(estimatedHeightCeilingMetres);
    expect(lonely.heightMetres).toBe(defaultHeightMetres);
  });

  it('extrudes roofs and walls into one geometry', () => {
    const geometry = buildingGeometry([square(0, 0, 8.4)], 4.2);
    // Two roof triangles plus four walls of two triangles each.
    expect(geometry.getAttribute('position').count).toBe((2 + 8) * 3);
    expect(geometry.boundingBox ?? (geometry.computeBoundingBox(), geometry.boundingBox)).toMatchObject({ max: { y: 2 } });
  });

  it('bundles an attributed extract around the camera ground region', () => {
    expect(data.attribution).toContain('OpenStreetMap');
    expect(data.license).toContain('ODbL');
    const footprints = decodeBuildings(data);
    expect(footprints.length).toBeGreaterThan(1000);
    for (const { ring, heightMetres } of footprints) {
      expect(heightMetres).toBeGreaterThan(0);
      for (const [x, y] of ring) {
        expect(x).toBeGreaterThan(200); expect(x).toBeLessThan(1080);
        expect(y).toBeGreaterThan(20); expect(y).toBeLessThan(730);
      }
    }
  });
});
