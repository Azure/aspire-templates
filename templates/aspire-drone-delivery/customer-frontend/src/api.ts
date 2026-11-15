import { coffeeDescription, menuItem, metresPerUnit } from './demo';
import type { Bag, Destination, Order, OrderFlight, PayloadSize } from './demo';
import { fromLonLat, toLonLat } from './mapGeometry';

export type GeoPoint = { latitude: number; longitude: number };
export type Telemetry = {
  droneId: string; class: 'Piccolo' | 'Doppio' | 'Abbondante'; sequence: number; timestamp: string;
  position: GeoPoint; homePad: GeoPoint; altitudeMetres: number; heading: number; batteryPercent: number;
  state: 'Charging' | 'Parked' | 'FlyingToPickup' | 'Loading' | 'FlyingToCustomer' | 'Unloading' | 'ReturningToPad';
  manoeuvre: 'OnTheGround' | 'VerticalClimb' | 'Cruise' | 'VerticalDescent'; orderId: string | null; queuedMissions: number;
  flightProgress?: number | null;
};
export type OrderSnapshot = {
  order: { orderId: string; customerName: string; dropOff: GeoPoint; payloadBays: PayloadSize; lines: { item: string; bays: number }[]; placedAt: string };
  store: { id: string; name: string; location: GeoPoint }; readyAt: string;
  status: 'AwaitingFleet' | 'Scheduled' | 'DroneEnRoute' | 'PickedUp' | 'Delivered' | 'Unserviceable';
  droneId: string | null; estimatedDelivery: string | null; deliveredAt: string | null; note: string | null;
  photos: { blobName: string; trigger: string; proofOfDelivery: boolean; timestamp: string }[];
  telemetry?: Telemetry | null;
};
export type Receipt = { id: string; bag: Bag; payload: PayloadSize; placedAt: string; dropOff: Destination };

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed (${response.status}). ${await response.text()}`);
  return response.json() as Promise<T>;
}
export async function placeOrder(bag: Bag, payload: PayloadSize, dropOff: Destination): Promise<Receipt> {
  const [longitude, latitude] = toLonLat(dropOff.x, dropOff.y);
  const result = await request<{ orderId: string }>('/api/orders', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      customerName: 'You', dropOff: { latitude, longitude }, payloadBays: payload,
      lines: bag.flatMap(line => Array.from({ length: line.quantity }, () => `${menuItem(line.itemId).name}${line.coffee ? ` · ${coffeeDescription(line.coffee)}` : ''}`)),
    }),
  });
  return { id: result.orderId, bag, payload, dropOff, placedAt: new Date().toISOString() };
}

const point = (geo: GeoPoint) => fromLonLat(geo.longitude, geo.latitude);
export function stageFor(snapshot: OrderSnapshot, now = Date.now()): Order['stage'] {
  if (snapshot.status === 'Delivered') return 'Delivered';
  if (snapshot.status === 'PickedUp') return 'Delivering';
  return now >= Date.parse(snapshot.readyAt) ? 'Ready for pickup' : 'Preparing';
}

export function trackingFor(snapshot: OrderSnapshot, now = Date.now()): OrderFlight | undefined {
  const drone = snapshot.telemetry;
  if (!snapshot.droneId || !drone || drone.droneId !== snapshot.droneId || drone.orderId !== snapshot.order.orderId) return undefined;
  // An old fix is not a live view; never extrapolate into a different mission or invent a flight leg.
  if (now - Date.parse(drone.timestamp) > 30000 || drone.state === 'ReturningToPad') return undefined;
  const inbound = drone.state === 'FlyingToPickup' || drone.state === 'Loading';
  if (!inbound && drone.state !== 'FlyingToCustomer' && drone.state !== 'Unloading') return undefined;
  const destination = { ...point(snapshot.order.dropOff), label: 'Your drop-off' };
  const origin = inbound ? point(drone.homePad) : point(snapshot.store.location);
  const target = inbound ? { ...point(snapshot.store.location), label: 'ForthCoffee pickup' } : destination;
  const location = point(drone.position);
  const remaining = Math.hypot(target.x - location.x, target.y - location.y);
  const manoeuvre = ({ OnTheGround: 'On the ground', VerticalClimb: 'Vertical climb', Cruise: 'Cruise', VerticalDescent: 'Vertical descent' } as const)[drone.manoeuvre];
  const phase = drone.state === 'FlyingToPickup' ? 'To pickup' : drone.state === 'Loading' ? 'On the pad'
    : drone.state === 'FlyingToCustomer' ? 'In flight' : 'Landed';
  return {
    ...location, droneId: drone.droneId, phase, manoeuvre, origin, target, destination,
    progress: drone.flightProgress === undefined || drone.flightProgress === null ? 0 : fraction(drone.flightProgress),
    heading: (drone.heading - 90) * Math.PI / 180, altitude: Math.round(drone.altitudeMetres),
    cameraDown: manoeuvre === 'Cruise' ? 0 : 1,
    remainingMetres: Math.round(remaining * metresPerUnit),
    etaSeconds: snapshot.estimatedDelivery ? Math.max(0, Math.ceil((Date.parse(snapshot.estimatedDelivery) - now) / 1000)) : 0,
  };
}

const fraction = (value: number) => Math.max(0, Math.min(1, value));
// Progress through the current stage, driven by the server snapshot and live drone telemetry.
export function stageProgressFor(snapshot: OrderSnapshot, tracking: OrderFlight | undefined, now = Date.now()): number {
  const stage = stageFor(snapshot, now);
  if (stage === 'Delivered') return 1;
  if (stage === 'Preparing') {
    const placed = Date.parse(snapshot.order.placedAt), ready = Date.parse(snapshot.readyAt);
    return ready > placed ? fraction((now - placed) / (ready - placed)) : 0;
  }
  const inbound = tracking?.phase === 'To pickup' || tracking?.phase === 'On the pad';
  if (stage === 'Ready for pickup') return tracking && inbound ? tracking.progress : 0;
  return tracking && !inbound ? tracking.progress : 0;
}

export function customerOrder(snapshot: OrderSnapshot, receipt: Receipt, now = Date.now()): Order {
  if (snapshot.order.orderId !== receipt.id) throw new Error('Order response does not match your receipt.');
  const tracking = trackingFor(snapshot, now);
  const photo = snapshot.photos.filter(frame => snapshot.droneId && frame.blobName.startsWith(`${snapshot.droneId}/`)).at(-1);
  return {
    id: receipt.id, customer: 'You', bag: receipt.bag, payload: receipt.payload, manual: true, backend: true,
    stage: stageFor(snapshot, now), elapsed: Math.max(0, (now - Date.parse(snapshot.order.placedAt)) / 1000),
    drone: snapshot.droneId ? { id: snapshot.droneId, pickupOrigin: point(snapshot.store.location), assignedAt: 0 } : undefined,
    tracking, stageProgress: stageProgressFor(snapshot, tracking, now), pickup: { ...point(snapshot.store.location), label: snapshot.store.name },
    dropOff: { ...point(snapshot.order.dropOff), label: receipt.dropOff.label }, note: snapshot.note,
    etaSeconds: snapshot.estimatedDelivery ? Math.max(0, Math.ceil((Date.parse(snapshot.estimatedDelivery) - now) / 1000)) : undefined,
    photo: photo ? { url: `/api/photos/${photo.blobName.split('/').map(encodeURIComponent).join('/')}`, timestamp: photo.timestamp, proofOfDelivery: photo.proofOfDelivery } : undefined,
  };
}
