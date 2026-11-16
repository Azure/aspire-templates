import { traced } from './telemetry';
export type GeoPoint = { latitude: number; longitude: number };
export type Telemetry = {
  droneId: string; class: 'Piccolo' | 'Doppio' | 'Abbondante'; sequence: number; timestamp: string;
  position: GeoPoint; homePad: GeoPoint; altitudeMetres: number; heading: number; batteryPercent: number;
  state: 'Charging' | 'Parked' | 'FlyingToPickup' | 'Loading' | 'FlyingToCustomer' | 'Unloading' | 'ReturningToPad' | 'EmergencyLanding' | 'Grounded' | 'FlyingToWaste' | 'DiscardingPackage';
  manoeuvre: 'OnTheGround' | 'VerticalClimb' | 'Cruise' | 'VerticalDescent'; orderId: string | null; queuedMissions: number;
  cameraPitchDegrees: number; carryingPackage: boolean;
  control: { commandId: string; command: DroneCommand; status: 'Executing' | 'Completed' | 'Rejected'; message: string } | null;
};
export type DroneCommand = 'EmergencyLanding' | 'ReturnToBase' | 'DiscardPackage' | 'Reactivate';
export type OrderSnapshot = {
  order: { orderId: string; customerName: string; payloadBays: 1 | 2 | 4; lines: { item: string; bays: number }[] };
  store: { id: string; name: string; location: GeoPoint }; readyAt: string;
  status: 'AwaitingFleet' | 'Scheduled' | 'DroneEnRoute' | 'PickedUp' | 'Delivered' | 'Unserviceable' | 'Failed';
  droneId: string | null; estimatedDelivery: string | null; note: string | null;
};
export type Store = { id: string; name: string; location: GeoPoint };

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
export function stageFor(snapshot: OrderSnapshot, now = Date.now()) {
  if (snapshot.status === 'Failed' || snapshot.status === 'Unserviceable') return 'Unable to complete';
  if (snapshot.status === 'Delivered') return 'Delivered';
  if (snapshot.status === 'PickedUp') return 'Delivering';
  return now >= Date.parse(snapshot.readyAt) ? 'Ready for pickup' : 'Preparing';
}
