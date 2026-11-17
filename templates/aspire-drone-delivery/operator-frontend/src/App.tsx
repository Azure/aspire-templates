import { useCallback, useMemo, useState } from 'react';
import { Coffee, Drone, MapPin, ShieldCheck } from 'lucide-react';
import DeliveryMap from './DeliveryMap';
import { fleetRequest, ordersRequest, stageFor, storesRequest } from './api';
import { fromLonLat } from './mapGeometry';
import { useRealtimeSnapshot } from './useApi';
import { airborne, droneLabel, fleetMap } from './model';
import DroneDrawer from './DroneDrawer';
import { camPads } from '../../frontend-shared/pads';

export default function App() {
  const load = useCallback(async (signal: AbortSignal) => {
    const [fleet, orders, stores] = await Promise.all([fleetRequest(signal), ordersRequest(signal), storesRequest(signal)]);
    return { fleet, orders, stores };
  }, []);
  const { data, error, loading } = useRealtimeSnapshot(load, { fleet: [], orders: [], stores: [] });
  const held = useMemo(() => new Set(data.fleet.map(drone => drone.padId).filter(Boolean)), [data.fleet]);
  const stores = useMemo(() => data.stores.map(store => ({ ...fromLonLat(store.location.longitude, store.location.latitude), label: store.name,
    pads: store.pads?.map(pad => ({ id: pad.id, held: held.has(pad.id), ...fromLonLat(pad.location.longitude, pad.location.latitude) })) })), [data.stores, held]);
  const pads = useMemo(() => camPads(data.stores), [data.stores]);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedDrone = data.fleet.find(drone => drone.droneId === selected);
  const active = data.orders.filter(snapshot => !['Delivered', 'Failed', 'Unserviceable'].includes(snapshot.status));
  return <div className="app-shell">
    <div className="demo-strip"><span>FORTHCOFFEE / FLEET OPERATIONS</span><span>Simulated drones. Shared logistics.</span></div>
    <header className="site-header"><a className="wordmark" href="/"><span className="brand-symbol"><Coffee size={23} /></span>Forth<span className="wordmark-light">Coffee</span><span className="brand-period">.</span></a><span className="location"><MapPin size={14} />South Melbourne operations</span></header>
    <main className="vendor-main">
      <div className="vendor-heading"><div><div className="eyebrow">THE STORE, THE DISPATCH QUEUE, THE FLEET</div><h1>From the bar,<br /><em>to the sky.</em></h1><p>Shared orders and every drone, straight from the demo server.</p></div><span className="live-pill"><span className="live-dot" />{error ? 'Updates unavailable' : loading ? 'Connecting' : 'Server simulation live'}</span></div>
      {error && <p className="form-error" role="alert">{error} Shown data is the last received snapshot.</p>}
      <div className="stat-grid">
        <div><span>ON THE BAR <Coffee size={15} /></span><strong>{active.length.toString().padStart(2, '0')}</strong><small>Latest 100 orders</small></div>
        <div><span>IN THE AIR <Drone size={16} /></span><strong>{data.fleet.filter(airborne).length}<em>/ {data.fleet.length}</em></strong><small>Reported fleet telemetry</small></div>
        <div><span>CHARGING</span><strong>{data.fleet.filter(drone => drone.state === 'Charging').length}</strong><small>On their home pads</small></div>
        <div><span>DELIVERED</span><strong>{data.orders.filter(snapshot => snapshot.status === 'Delivered').length}</strong><small>In the latest order snapshot</small></div>
      </div>
      <div className="operations-grid">
        <section className="operations-map"><div className="panel-heading"><h2>Our patch of sky</h2></div>
          <DeliveryMap fleet={fleetMap(data.fleet)} stores={stores} />
          <div className="map-legend"><span>Actual simulator positions · all reported drones</span></div>
        </section>
        <aside className="dispatch-panel"><div className="panel-heading"><h2>On the docket <span className="count-badge">{active.length}</span></h2><span className="eyebrow">DISPATCH QUEUE</span></div><p className="queue-intro">Prepared at the store. Dispatched by logistics.</p>
          <div className="order-list">{active.map(snapshot => <article className="queue-order" key={snapshot.order.orderId}>
            <div className="queue-order-top"><strong>{snapshot.order.orderId} / {snapshot.order.payloadBays} bays</strong><span className={`status-tag ${stageFor(snapshot) === 'Ready for pickup' ? 'ready' : snapshot.status === 'PickedUp' ? 'flying' : ''}`}>{stageFor(snapshot)}</span></div>
            <h3>{snapshot.order.customerName}</h3><p>{snapshot.store.name}</p>
            {snapshot.order.lines.map((line, index) => <p key={index}>{line.item}</p>)}
            <div className="queue-order-bottom"><span>{snapshot.droneId ?? 'Awaiting assignment'} · {snapshot.status}</span></div>
            {snapshot.estimatedDelivery && <p>Estimated delivery: {new Date(snapshot.estimatedDelivery).toLocaleTimeString()}</p>}
            {snapshot.note && <p>{snapshot.note}</p>}
          </article>)}</div>
          {!loading && !active.length && <p>No active orders in the latest snapshot.</p>}
        </aside>
      </div>
      <section className="operations-roster"><div className="section-heading"><h2>On the roster</h2><p>Live battery, work and class from the simulator.</p></div>
        <div className="operations-drones">{data.fleet.map(drone => <article key={drone.droneId}><Drone size={22} /><strong>{drone.droneId}</strong><span>{drone.class} · {droneLabel(drone)}</span><span>{Math.round(drone.batteryPercent)}% battery · ALT {Math.round(drone.altitudeMetres)} m</span><small>{drone.orderId ?? 'No active order'} · {drone.queuedMissions} queued</small><button className="outline-button" onClick={() => setSelected(drone.droneId)} aria-label={`Inspect drone ${drone.droneId}`}>Camera &amp; controls</button></article>)}</div>
      </section>
      <p className="privacy-note"><ShieldCheck size={14} />Fictional orders and flights. Logistics handles dispatch; operator commands affect the simulation only.</p>
    </main>
    <footer><span className="footer-brand">ForthCoffee.</span><span>Fleet operations · Built with Aspire.</span></footer>
    {selectedDrone && <DroneDrawer key={selectedDrone.droneId} drone={selectedDrone} fleet={data.fleet} pads={pads} onSelect={setSelected} onClose={() => setSelected(null)} />}
  </div>;
}
