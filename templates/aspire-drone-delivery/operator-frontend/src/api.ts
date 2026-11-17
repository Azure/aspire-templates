import { traced } from './telemetry';
import type { FlightWaypoint } from '../../frontend-shared/pose';
import type { ManualInput } from './manualFlight';
export type GeoPoint = { latitude: number; longitude: number };
export type Telemetry = {
  droneId: string; class: 'Piccolo' | 'Doppio' | 'Abbondante'; sequence: number; timestamp: string;
  position: GeoPoint; homePad: GeoPoint; altitudeMetres: number; heading: number; batteryPercent: number;
  state: 'Charging' | 'Parked' | 'FlyingToPickup' | 'Loading' | 'FlyingToCustomer' | 'Unloading' | 'ReturningToPad' | 'EmergencyLanding' | 'Grounded' | 'FlyingToWaste' | 'DiscardingPackage';
  manoeuvre: 'OnTheGround' | 'VerticalClimb' | 'Cruise' | 'VerticalDescent'; orderId: string | null; queuedMissions: number;
  cameraPitchDegrees: number; carryingPackage: boolean;
  pitchDegrees?: number; rollDegrees?: number; speedMetresPerSecond?: number;
  plannedRoute?: FlightWaypoint[] | null; routingError?: string | null; padId?: string | null;
  control: { commandId: string; command: DroneCommand; status: 'Executing' | 'Completed' | 'Rejected'; message: string } | null;
  manual?: ManualControlState | null; cameraYawDegrees?: number;
};
export type ManualControlState = {
  sessionId: string; status: 'Active' | 'LinkLost' | 'Released' | 'Rejected'; acknowledged: number;
  appliedSeconds: number; linkLostSeconds: number; message: string;
};
export type ManualAction = 'Take' | 'Resume' | 'ReturnToBase';
export type DroneCommand = 'EmergencyLanding' | 'ReturnToBase' | 'DiscardPackage' | 'Reactivate';
export type OrderSnapshot = {
  order: { orderId: string; customerName: string; payloadBays: 1 | 2 | 4; lines: { item: string; bays: number }[] };
  store: { id: string; name: string; location: GeoPoint }; readyAt: string;
  status: 'AwaitingFleet' | 'Scheduled' | 'DroneEnRoute' | 'PickedUp' | 'Delivered' | 'Unserviceable' | 'Failed';
  droneId: string | null; estimatedDelivery: string | null; note: string | null; arrivalIndeterminate?: boolean;
};
export type Store = { id: string; name: string; location: GeoPoint; pads?: { id: string; number: number; location: GeoPoint }[]; deckAltitudeMetres?: number };

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await traced('operator load snapshot', { 'url.path': path.split('?')[0] }, () => fetch(path, { signal }));
  if (!response.ok) throw new Error(`GET ${path} failed (${response.status}). ${await response.text()}`);
  return response.json() as Promise<T>;
}
export const fleetRequest = (signal?: AbortSignal) => request<Telemetry[]>('/api/fleet', signal);
export const ordersRequest = (signal?: AbortSignal) => request<OrderSnapshot[]>('/api/orders?take=100', signal);
export const storesRequest = (signal?: AbortSignal) => request<Store[]>('/api/stores', signal);
export async function commandDrone(droneId: string, command: DroneCommand): Promise<{ commandId: string }> {
  const response = await traced('operator command drone', {
    'drone_delivery.drone.id': droneId, 'drone_delivery.command': command,
  }, () => fetch(`/api/fleet/${encodeURIComponent(droneId)}/commands?command=${command}`, { method: 'POST' }));
  if (!response.ok) throw new Error(`Command not accepted (${response.status}): ${await response.text()}`);
  return response.json();
}
export async function manualControl(droneId: string, sessionId: string, action: ManualAction): Promise<{ requestId: string }> {
  const response = await traced('operator manual control', {
    'drone_delivery.drone.id': droneId, 'drone_delivery.manual.action': action,
  }, () => fetch(`/api/fleet/${encodeURIComponent(droneId)}/manual`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, action }),
  }));
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try { message = (JSON.parse(text) as { message?: string }).message ?? text; } catch { /* plain text */ }
    throw new Error(message || `Manual control not accepted (${response.status}).`);
  }
  return response.json();
}
/** Stick input at ~10 Hz. Deliberately untraced: one span per heartbeat would flood the dashboard. */
export async function sendManualInput(droneId: string, sessionId: string, sequence: number, input: ManualInput): Promise<boolean> {
  const response = await fetch(`/api/fleet/${encodeURIComponent(droneId)}/manual/input`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId, sequence, input }), keepalive: true,
  });
  return response.ok;
}
export function stageFor(snapshot: OrderSnapshot, now = Date.now()) {
  if (snapshot.status === 'Failed' || snapshot.status === 'Unserviceable') return 'Unable to complete';
  if (snapshot.status === 'Delivered') return 'Delivered';
  if (snapshot.status === 'PickedUp') return 'Delivering';
  return now >= Date.parse(snapshot.readyAt) ? 'Ready for pickup' : 'Preparing';
}
