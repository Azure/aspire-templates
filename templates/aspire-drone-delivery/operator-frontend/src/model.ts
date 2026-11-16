import type { DroneCommand, Telemetry } from './api';
import { fromLonLat } from './mapGeometry';

export const droneLabel = (drone: Telemetry) => drone.state.replace(/([a-z])([A-Z])/g, '$1 $2');
export function fleetMap(drones: Telemetry[]) {
  return drones.map(drone => ({
    id: drone.droneId, ...fromLonLat(drone.position.longitude, drone.position.latitude), status: droneLabel(drone),
  }));
}
export const airborne = (drone: Telemetry) => drone.manoeuvre !== 'OnTheGround';

export function commandUnavailable(drone: Telemetry, command: DroneCommand) {
  if (drone.control?.status === 'Executing') return 'A command is already in progress.';
  if (Date.now() - Date.parse(drone.timestamp) > 30000) return 'Waiting for current telemetry.';
  if (command === 'Reactivate') return drone.state === 'Grounded' ? '' : 'Only grounded drones need reactivation.';
  if (drone.state === 'Grounded') return 'Reactivate this grounded drone first.';
  if (command === 'DiscardPackage' && !drone.carryingPackage) return 'No package on board.';
  return '';
}
