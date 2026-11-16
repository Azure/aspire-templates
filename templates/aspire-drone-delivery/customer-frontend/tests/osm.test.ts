import { describe, expect, it } from 'vitest';
import { latLng, osmAttribution, osmTileUrl } from '../../frontend-shared/osm';

describe('OpenStreetMap helpers', () => {
  it('places the illustrated kitchen on real South Melbourne coordinates', () => {
    const [lat, lon] = latLng({ x: 510, y: 318 });
    expect(lat).toBeCloseTo(-37.832, 3);
    expect(lon).toBeCloseTo(144.957, 3);
  });

  it('uses the standard tile server and credits OpenStreetMap contributors', () => {
    expect(osmTileUrl).toBe('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    expect(osmAttribution).toContain('OpenStreetMap');
    expect(osmAttribution).toContain('https://www.openstreetmap.org/copyright');
  });
});
