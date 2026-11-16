import { describe, expect, it, vi } from 'vitest';
import { fetchTile, latLng, lonLatToTile, osmAttribution, tilesFor, tileToLonLat, tileUrl } from '../../frontend-shared/osm';

describe('OpenStreetMap helpers', () => {
  it('places the illustrated kitchen on real South Melbourne coordinates', () => {
    const [lat, lon] = latLng({ x: 510, y: 318 });
    expect(lat).toBeCloseTo(-37.832, 3);
    expect(lon).toBeCloseTo(144.957, 3);
  });

  it('builds standard tile URLs and credits OpenStreetMap contributors', () => {
    expect(tileUrl(16, 59158, 40227)).toBe('https://tile.openstreetmap.org/16/59158/40227.png');
    expect(osmAttribution).toContain('OpenStreetMap');
    expect(osmAttribution).toContain('https://www.openstreetmap.org/copyright');
  });

  it('round-trips tile coordinates', () => {
    const [x, y] = lonLatToTile(144.957, -37.832, 16);
    const [lon, lat] = tileToLonLat(x, y, 16);
    expect(lon).toBeLessThanOrEqual(144.957);
    expect(lat).toBeGreaterThanOrEqual(-37.832);
  });

  it('keeps the camera ground within a bounded tile request', () => {
    const tiles = tilesFor({ x: 280, y: 100, width: 720, height: 550 }, 16);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(64);
    expect(() => tilesFor({ x: 0, y: 0, width: 1000, height: 650 }, 18)).toThrow(/Refusing/);
  });

  it('fetches each tile once and retries after a failure', async () => {
    const ok = vi.fn(async () => new Response(new Blob(['png'])));
    await fetchTile(16, 1, 1, ok);
    await fetchTile(16, 1, 1, ok);
    expect(ok).toHaveBeenCalledTimes(1);
    const failing = vi.fn(async () => new Response('', { status: 503 }));
    await expect(fetchTile(16, 2, 2, failing)).rejects.toThrow(/503/);
    await expect(fetchTile(16, 2, 2, failing)).rejects.toThrow(/503/);
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
