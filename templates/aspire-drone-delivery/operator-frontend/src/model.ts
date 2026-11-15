import type { Telemetry } from './api';
import { fromLonLat } from './mapGeometry';

export const droneLabel = (drone: Telemetry) => drone.state.replace(/([a-z])([A-Z])/g, '$1 $2');
export function fleetMap(drones: Telemetry[]) {
  return drones.map(drone => ({
    id: drone.droneId, ...fromLonLat(drone.position.longitude, drone.position.latitude), status: droneLabel(drone),
  }));
}
export const airborne = (drone: Telemetry) => drone.manoeuvre !== 'OnTheGround';
