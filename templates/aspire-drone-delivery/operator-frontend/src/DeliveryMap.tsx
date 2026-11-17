import { Drone } from 'lucide-react';
import OsmMap from '../../frontend-shared/OsmMap';
import type { MapFlight, MapStore } from '../../frontend-shared/OsmMap';

export type Flight = MapFlight;
const overview = { x: 640, y: 375 };
const operationsArea: [{ x: number; y: number }, { x: number; y: number }] = [{ x: 360, y: 170 }, { x: 960, y: 610 }];

export default function DeliveryMap({ fleet, stores }: { fleet: Flight[]; stores: MapStore[] }) {
  return <div className="delivery-map">
    <OsmMap center={overview} zoom={15} fit={operationsArea} flights={fleet} stores={stores} ariaLabel="OpenStreetMap of South Melbourne with ForthCoffee stores and reported drone positions" />
    <div className="map-location"><span className="live-dot" /> South Melbourne, VIC <span className="map-location-detail">/ SIMULATED AIRSPACE</span></div>
    <div className="map-fleet"><div><span className="live-dot" /> FLEET AT A GLANCE</div><strong>{fleet.length} drones. One small sky.</strong><p>Shared backend telemetry</p><div className="fleet-avatars">{fleet.map(flight => <span key={flight.id} title={`${flight.id}: ${flight.status}`}><Drone size={17} /></span>)}<small>Reported simulator positions</small></div></div>
  </div>;
}
