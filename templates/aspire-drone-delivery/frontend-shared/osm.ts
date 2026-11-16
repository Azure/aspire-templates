// OpenStreetMap tile helpers. The public tile server suits demo and development traffic only:
// https://operations.osmfoundation.org/policies/tiles/ requires attribution, no bulk downloads,
// and honouring HTTP caching. Browsers send the required Referer/User-Agent themselves.
import { toLonLat } from './mapGeometry';

export const osmTileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const osmMaxZoom = 19;

export type Point = { x: number; y: number };
export type Region = Point & { width: number; height: number };

/** Leaflet expects [latitude, longitude]; map geometry stores illustrated units mapped to real South Melbourne coordinates. */
export function latLng(point: Point): [number, number] {
  const [lon, lat] = toLonLat(point.x, point.y);
  return [lat, lon];
}

export function tileUrl(z: number, x: number, y: number) {
  return osmTileUrl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}

export function lonLatToTile(lon: number, lat: number, zoom: number) {
  const n = 2 ** zoom, rad = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n)] as const;
}

export function tileToLonLat(x: number, y: number, zoom: number) {
  const n = 2 ** zoom;
  return [x / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI] as const;
}

/** Tiles covering a region, refusing anything that would look like a bulk download. */
export function tilesFor(region: Region, zoom: number, limit = 64): [number, number][] {
  const [west, north] = toLonLat(region.x, region.y);
  const [east, south] = toLonLat(region.x + region.width, region.y + region.height);
  const [x0, y0] = lonLatToTile(west, north, zoom), [x1, y1] = lonLatToTile(east, south, zoom);
  const tiles: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
  if (tiles.length > limit) throw new Error(`Refusing to fetch ${tiles.length} OpenStreetMap tiles (limit ${limit}).`);
  return tiles;
}

const tileCache = new Map<string, Promise<Blob>>();

/** Fetches a tile once per page; later camera views reuse the same response. */
export function fetchTile(z: number, x: number, y: number, fetcher: typeof fetch = fetch): Promise<Blob> {
  const url = tileUrl(z, x, y);
  let pending = tileCache.get(url);
  if (!pending) {
    pending = fetcher(url).then(response => {
      if (!response.ok) throw new Error(`OpenStreetMap tile request failed (${response.status}).`);
      return response.blob();
    });
    pending.catch(() => tileCache.delete(url));
    tileCache.set(url, pending);
  }
  return pending;
}
