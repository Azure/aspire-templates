import { fromLonLat } from './mapGeometry';
import type { CamPad } from './DroneCam';

type GeoPoint = { latitude: number; longitude: number };
/** Store landing pads as served by /api/stores and order snapshots. */
export type StorePads = { pads?: { id: string; location: GeoPoint }[]; deckAltitudeMetres?: number };

export function camPads(stores: readonly StorePads[]): CamPad[] {
  return stores.flatMap(store => (store.pads ?? []).map(pad => ({
    id: pad.id, ...fromLonLat(pad.location.longitude, pad.location.latitude), altitudeMetres: store.deckAltitudeMetres ?? 0,
  })));
}
