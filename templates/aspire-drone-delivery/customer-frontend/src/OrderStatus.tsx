import { lazy, Suspense, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChefHat, Drone, FastForward, House, Layers, MapPin, Package, ShieldCheck } from 'lucide-react';
import { AzureBasemap, MapArtwork } from './DeliveryMap';
import type { MapSettings } from './DeliveryMap';
import FoodArt, { CoffeeCup } from './FoodArt';
import { baristaFor } from './baristas';
import { skipOrderStage } from './api';
import { bagCount, bagTotal, coffeeDescription, linePrice, menuItem, money, orderFlight, payloadNames, stages, stageTicks } from './demo';
import type { Order, OrderFlight } from './demo';

const DroneCam = lazy(() => import('./DroneCam'));
const stageIcons = [ChefHat, Package, Drone, House];
const stageCopy = {
  Preparing: { title: 'Your barista is on it.', detail: 'ForthCoffee is brewing your coffee run, just the way you like it.' },
  'Ready for pickup': { title: 'Ready. Your drone is on its way to the bar.', detail: 'Packed and sealed. Follow your assigned drone as it flies to ForthCoffee for pickup.' },
  Delivering: { title: 'Look up. It’s on its way.', detail: 'Follow your drone overhead and through its camera.' },
  Delivered: { title: 'Your morning has landed.', detail: 'Your drone has landed at the drop-off. Enjoy your ForthCoffee moment.' },
} as const;
const duration = { Preparing: stageTicks.preparing, 'Ready for pickup': stageTicks.ready, Delivering: stageTicks.flight, Delivered: 1 } as const;

function eta(seconds: number) {
  if (seconds <= 0) return 'Arrived';
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

function BaristaCard({ orderId }: { orderId: string }) {
  const barista = baristaFor(orderId);
  return <section className="barista-card" aria-label={`Your barista, ${barista.name}`}>
    <img src={barista.avatar} alt={`Illustrated portrait of ${barista.name}`} width={96} height={96} />
    <div>
      <span className="eyebrow">YOUR BARISTA</span>
      <h2>{barista.name}<small>On the bar since {barista.since}</small></h2>
      <p>{barista.backstory}</p>
      <dl>
        <div><dt>AFL team</dt><dd>{barista.aflTeam}</dd></div>
        <div><dt>Favourite coffee</dt><dd>{barista.favouriteCoffee}</dd></div>
        {barista.facts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}
      </dl>
      <small className="barista-note">A fictional barista profile for this demo.</small>
    </div>
  </section>;
}

function FollowMap({ flight, settings, onSettings }: { flight: OrderFlight; settings: MapSettings | null; onSettings: () => void }) {
  if (!flight.droneId) return null;
  const angle = flight.heading * 180 / Math.PI;
  const width = 560, height = 440;
  return <div className="follow-map">
    {settings ? <AzureBasemap settings={settings} flights={[{ id: flight.droneId, x: flight.x, y: flight.y, status: flight.phase }]} follow={flight} route={flight.target} routeOrigin={flight.origin} stores={[{ ...(flight.target.label === 'ForthCoffee pickup' ? flight.target : flight.origin), label: 'ForthCoffee' }]} />
      : <svg viewBox={`${flight.x - width / 2} ${flight.y - height / 2} ${width} ${height}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Overhead illustrated map centred on drone ${flight.droneId}`}>
        <MapArtwork routes={false} store={false} />
        <line x1={flight.origin.x} y1={flight.origin.y} x2={flight.target.x} y2={flight.target.y} stroke="#184b38" strokeWidth="2.5" strokeDasharray="6 6" opacity=".55" />
        <line x1={flight.origin.x} y1={flight.origin.y} x2={flight.x} y2={flight.y} stroke="#184b38" strokeWidth="3.5" strokeLinecap="round" />
        <g transform={`translate(${flight.target.x} ${flight.target.y})`}>
          <circle r="15" fill="#e9b44c" opacity=".25" className="drop-pulse" /><circle r="7" fill="#e9b44c" stroke="#fff" strokeWidth="2.5" />
          <rect x="20" y="-9" width="112" height="17" rx="8" fill="#fffdf5" /><text x="76" y="3" textAnchor="middle" className="tiny-label">{flight.target.label === 'ForthCoffee pickup' ? 'ForthCoffee pickup' : 'Your drop-off'}</text>
        </g>
        <g transform={`translate(${flight.x} ${flight.y})`}>
          <circle r="17" fill="#fff" opacity=".7" />
          <g transform={`rotate(${angle})`}><path d="M13 0 L-7 -9 L-3 0 L-7 9Z" fill="#184b38" stroke="#fff" strokeWidth="1.5" /></g>
          <rect x="-24" y="-35" width="48" height="16" rx="7" fill="#184b38" /><text y="-24" textAnchor="middle" fill="#fff" className="drone-label">{flight.droneId}</text>
        </g>
      </svg>}
    <div className="map-location"><span className="live-dot" /> Following {flight.droneId}</div>
    <button className="map-layers" onClick={onSettings}><Layers size={15} />{settings ? 'Azure Maps' : 'Map options'}</button>
    <div className="map-credit">{settings ? 'Azure Maps · simulated position' : 'Illustrated overhead view · simulated position'}</div>
  </div>;
}

export default function OrderStatus({ order, orderId, settings, onSettings, onBack }: {
  order: Order | undefined; orderId: string; settings: MapSettings | null; onSettings: () => void; onBack: () => void;
}) {
  const [skipping, setSkipping] = useState(false);
  const [skipError, setSkipError] = useState('');
  useEffect(() => { setSkipping(false); setSkipError(''); }, [orderId, order?.stage]);
  async function skip() {
    if (!order || skipping) return;
    setSkipping(true);
    setSkipError('');
    try { await skipOrderStage(order.id, order.stage); }
    catch (reason) {
      setSkipError(reason instanceof Error ? reason.message : String(reason));
      setSkipping(false);
    }
  }
  if (!order) return <main className="status-page"><button className="text-button back-link" onClick={onBack}><ArrowLeft size={15} />Back to the menu</button>
    <section className="status-missing"><h1>We can’t find order {orderId}.</h1><p>This browser shows only the orders you placed here. The demo server resets on restart.</p><button className="primary-button" onClick={onBack}>Find something good <ArrowRight size={15} /></button></section></main>;

  const flight = orderFlight(order);
  const current = stages.indexOf(order.stage);
  const followable = current >= 1 && flight.droneId !== null && (!order.backend || !!order.tracking);
  const copy = order.stage === 'Ready for pickup' && !flight.droneId
    ? { title: 'Ready. Waiting for a drone.', detail: 'Your coffee run is packed and sealed. The map and camera will appear once a drone is assigned.' }
    : order.stage === 'Ready for pickup' && flight.phase === 'On the pad'
    ? { title: 'Ready. Your drone is at the bar.', detail: 'Your drone has landed at ForthCoffee. Next stop: your drop-off.' }
    : order.stage === 'Ready for pickup' && order.backend && !order.tracking
    ? { title: 'Ready. Waiting for your drone.', detail: 'Your assigned drone may still be serving another order. Live views appear when current telemetry for your order arrives.' }
    : stageCopy[order.stage];
  const items = bagCount(order.bag);
  return <main className="status-page">
    <button className="text-button back-link" onClick={onBack}><ArrowLeft size={15} />Back to the menu</button>
    <section className="status-header" aria-live="polite">
      <div><div className="eyebrow">ORDER {order.id} · FORTHCOFFEE · {payloadNames[order.payload].toUpperCase()} PAYLOAD</div><h1>{copy.title}</h1><p>{copy.detail}</p></div>
      <div className="status-eta"><span>{order.stage === 'Delivered' ? 'DELIVERED' : 'ESTIMATED ARRIVAL'}</span><strong>{order.stage === 'Delivered' ? 'Arrived' : order.backend ? (order.etaSeconds === undefined ? 'Awaiting estimate' : eta(order.etaSeconds)) : flight.droneId ? eta(flight.etaSeconds) : 'Awaiting drone'}</strong><small>{order.backend ? 'Demo server estimate' : 'Accelerated demo time'}</small></div>
    </section>
    <ol className="status-steps" aria-label="Order progress">{stages.map((stage, index) => {
      const Icon = stageIcons[index];
      const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
      const fill = state === 'done' ? 1 : state === 'current' ? (stage === 'Delivered' ? 1 : order.backend ? order.stageProgress ?? 0 : Math.min(1, order.elapsed / duration[stage])) : 0;
      return <li key={stage} className={state} aria-current={state === 'current' ? 'step' : undefined}>
        <span className="step-icon">{state === 'done' ? <Check size={16} /> : <Icon size={16} />}</span>
        <span className="step-label">{stage}
        {state === 'current' && stage !== 'Delivered' && <button className="stage-skip" type="button"
          aria-label={`Skip ${stage} (demo)`} title={stage === 'Ready for pickup' && !order.drone
            ? 'Waiting for an assigned drone' : 'Fast-forward this stage in the demo'}
          disabled={skipping || stage === 'Ready for pickup' && !order.drone}
          onClick={skip}><FastForward size={10} />{skipping ? 'Skipping…' : 'Skip'}</button>}</span>
        <span className="step-bar"><i style={{ width: `${fill * 100}%` }} /></span>
      </li>;
    })}</ol>
    {skipError && <p role="alert" className="skip-error">{skipError}</p>}

    <div className="status-grid">
      <section className="status-stage">
        {followable ? <div className="follow-views">
          <div className="follow-panel"><div className="follow-heading"><span><MapPin size={14} />Overhead</span><small>{flight.phase}</small></div><FollowMap flight={flight} settings={settings} onSettings={onSettings} /></div>
          <div className="follow-panel"><div className="follow-heading"><span><span className="rec-dot" />Drone camera</span><small>Simulated</small></div>
            <Suspense fallback={<div className="drone-cam"><div className="cam-fallback" role="status">Starting simulated camera…</div></div>}><DroneCam order={order} settings={settings} /></Suspense></div>
        </div> : <div className="kitchen-card">
          <div className="kitchen-food" data-count={Math.min(order.bag.length, 4)}>{order.bag.slice(0, 4).map(line => <div key={line.id}>{line.coffee ? <CoffeeCup options={line.coffee} style={line.itemId} /> : <FoodArt kind={menuItem(line.itemId).kind} />}</div>)}</div>
          <div><span className="eyebrow">YOUR COFFEE RUN</span><h2>Made your way.<br /><em>Then on its way.</em></h2><p>{order.stage === 'Ready for pickup' ? (order.drone ? 'Your drone is assigned. Waiting for current telemetry for this order; no unrelated flight is shown.' : 'Packed and waiting for an available drone. No drone is assigned yet.') : order.stage === 'Preparing' ? 'Your barista is preparing your flight box. Once a drone is assigned, follow its pickup and delivery through the map and simulated camera.' : order.stage === 'Delivered' ? 'Your coffee run has landed. Enjoy your ForthCoffee moment.' : 'Waiting for current telemetry from your assigned drone.'}</p>{order.note && <p role="status">{order.note}</p>}</div>
        </div>}
        {order.stage === 'Preparing' && <BaristaCard orderId={order.id} />}
      </section>
      <aside className="status-summary">
        <div className="eyebrow">YOUR COFFEE RUN</div>
        <ul>{order.bag.map(line => <li key={line.id}><span>{line.quantity} × {menuItem(line.itemId).name}{line.coffee && <small className="summary-coffee-options">{coffeeDescription(line.coffee)}</small>}</span><strong>{money(linePrice(line) * line.quantity)}</strong></li>)}</ul>
        <div className="summary-total"><span>Total · {items} {items === 1 ? 'item' : 'items'}</span><strong>{money(bagTotal(order.bag))}</strong></div>
        <dl>
          <div><dt>Drone</dt><dd>{flight.droneId ?? 'Not yet assigned'}</dd></div>
          <div><dt>Payload</dt><dd>{payloadNames[order.payload]}</dd></div>
          <div><dt>From</dt><dd>{order.pickup?.label ?? 'ForthCoffee, Coventry Street'}</dd></div>
          <div><dt>To</dt><dd>{flight.destination.label}</dd></div>
          {(order.stage === 'Delivering' || flight.phase === 'To pickup') && <div><dt>{flight.phase === 'To pickup' ? 'To pickup' : 'Distance left'}</dt><dd>{flight.remainingMetres} m</dd></div>}
        </dl>
        {order.stage === 'Delivered' && <button className="primary-button full-width" onClick={onBack}>Order something else <ArrowRight size={15} /></button>}
        {order.photo && <figure className="captured-frame"><img src={order.photo.url} alt={`Last simulated camera frame for ${order.id}`} /><figcaption>Last captured frame · {new Date(order.photo.timestamp).toLocaleTimeString()}{order.photo.proofOfDelivery ? ' · Proof of delivery' : ''}</figcaption></figure>}
        <p className="privacy-note"><ShieldCheck size={14} />Simulated order and flight. No payment, drone or camera is involved.</p>
      </aside>
    </div>
  </main>;
}
