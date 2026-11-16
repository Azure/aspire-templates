// OpenStreetMap basemap settings. The public tile server suits demo and development traffic only:
// https://operations.osmfoundation.org/policies/tiles/ requires attribution, no bulk downloads,
// and honouring HTTP caching. Leaflet and the browser handle caching and the Referer/User-Agent.
import { toLonLat } from './mapGeometry';

export const osmTileUrl = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const osmAttribution = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
export const osmMaxZoom = 19;

export type Point = { x: number; y: number };

/** Leaflet expects [latitude, longitude]; map geometry stores illustrated units mapped to real South Melbourne coordinates. */
export function latLng(point: Point): [number, number] {
  const [lon, lat] = toLonLat(point.x, point.y);
  return [lat, lon];
}
