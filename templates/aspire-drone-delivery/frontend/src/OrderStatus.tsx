import { lazy, Suspense } from 'react';
import { ArrowLeft, ArrowRight, Check, ChefHat, Drone, FastForward, House, Layers, MapPin, Package, ShieldCheck } from 'lucide-react';
import { AzureBasemap, MapArtwork } from './DeliveryMap';
import type { MapSettings } from './DeliveryMap';
import FoodArt from './FoodArt';
import { bagTotal, dropOff, kitchen, menu, money, orderFlight, stages, stageTicks } from './demo';
import type { Order, OrderFlight } from './demo';

const DroneCam = lazy(() => import('./DroneCam'));
const stageIcons = [ChefHat, Package, Drone, House];
const stageCopy = {
  Preparing: { title: 'Good things are in the making.', detail: 'Peninsula Kitchen is preparing your order.' },
  'Ready for pickup': { title: 'Ready. Your drone is warming up.', detail: 'Packed, sealed and on the pad. Take a look through the drone camera.' },
  Delivering: { title: 'Look up. It’s on its way.', detail: 'Follow your drone overhead and through its camera.' },
  Delivered: { title: 'A good thing has arrived.', detail: 'Your drone has landed at the drop-off. Enjoy!' },
} as const;
const duration = { Preparing: stageTicks.preparing, 'Ready for pickup': stageTicks.ready, Delivering: stageTicks.flight, Delivered: 1 } as const;

function eta(seconds: number) {
  if (seconds <= 0) return 'Arrived';
  const minutes = Math.floor(seconds / 60);
  return minutes ? `${minutes} min ${seconds % 60} s` : `${seconds} s`;
}

function FollowMap({ flight, settings, onSettings }: { flight: OrderFlight; settings: MapSettings | null; onSettings: () => void }) {
  const angle = flight.heading * 180 / Math.PI;
  const width = 560, height = 440;
  return <div className="follow-map">
    {settings ? <AzureBasemap settings={settings} flights={[{ id: flight.droneId, x: flight.x, y: flight.y, status: flight.phase }]} follow={flight} route />
      : <svg viewBox={`${flight.x - width / 2} ${flight.y - height / 2} ${width} ${height}`} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`Overhead illustrated map centred on drone ${flight.droneId}`}>
        <MapArtwork routes={false} />
        <line x1={kitchen.x} y1={kitchen.y} x2={dropOff.x} y2={dropOff.y} stroke="#184b38" strokeWidth="2.5" strokeDasharray="6 6" opacity=".55" />
        <line x1={kitchen.x} y1={kitchen.y} x2={flight.x} y2={flight.y} stroke="#184b38" strokeWidth="3.5" strokeLinecap="round" />
        <g transform={`translate(${dropOff.x} ${dropOff.y})`}>
          <circle r="15" fill="#e9b44c" opacity=".25" className="drop-pulse" /><circle r="7" fill="#e9b44c" stroke="#fff" strokeWidth="2.5" />
          <rect x="20" y="-9" width="84" height="17" rx="8" fill="#fffdf5" /><text x="62" y="3" textAnchor="middle" className="tiny-label">Your drop-off</text>
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

export default function OrderStatus({ order, orderId, settings, onSettings, onAdvance, onBack }: {
  order: Order | undefined; orderId: string; settings: MapSettings | null; onSettings: () => void; onAdvance: () => void; onBack: () => void;
}) {
  if (!order) return <main className="status-page"><button className="text-button back-link" onClick={onBack}><ArrowLeft size={15} />Back to the menu</button>
    <section className="status-missing"><h1>We can’t find order {orderId}.</h1><p>Demo orders live only in this browser tab and reset when the page reloads.</p><button className="primary-button" onClick={onBack}>Find something good <ArrowRight size={15} /></button></section></main>;

  const flight = orderFlight(order);
  const current = stages.indexOf(order.stage);
  const followable = current >= 1;
  const copy = stageCopy[order.stage];
  const items = Object.values(order.bag).reduce((sum, quantity) => sum + quantity, 0);
  return <main className="status-page">
    <button className="text-button back-link" onClick={onBack}><ArrowLeft size={15} />Back to the menu</button>
    <section className="status-header" aria-live="polite">
      <div><div className="eyebrow">ORDER {order.id} · PENINSULA KITCHEN</div><h1>{copy.title}</h1><p>{copy.detail}</p></div>
      <div className="status-eta"><span>{order.stage === 'Delivered' ? 'DELIVERED' : 'ESTIMATED ARRIVAL'}</span><strong>{eta(flight.etaSeconds)}</strong><small>Accelerated demo time</small></div>
    </section>
    <ol className="status-steps" aria-label="Order progress">{stages.map((stage, index) => {
      const Icon = stageIcons[index];
      const state = index < current ? 'done' : index === current ? 'current' : 'upcoming';
      const fill = state === 'done' ? 1 : state === 'current' ? (stage === 'Delivered' ? 1 : Math.min(1, order.elapsed / duration[stage])) : 0;
      return <li key={stage} className={state} aria-current={state === 'current' ? 'step' : undefined}>
        <span className="step-icon">{state === 'done' ? <Check size={16} /> : <Icon size={16} />}</span>
        <span className="step-label">{stage}</span>
        <span className="step-bar"><i style={{ width: `${fill * 100}%` }} /></span>
      </li>;
    })}</ol>

    <div className="status-grid">
      <section className="status-stage">
        {followable ? <div className="follow-views">
          <div className="follow-panel"><div className="follow-heading"><span><MapPin size={14} />Overhead</span><small>{flight.phase}</small></div><FollowMap flight={flight} settings={settings} onSettings={onSettings} /></div>
          <div className="follow-panel"><div className="follow-heading"><span><span className="rec-dot" />Drone camera</span><small>Simulated</small></div>
            <Suspense fallback={<div className="drone-cam"><div className="cam-fallback" role="status">Starting simulated camera…</div></div>}><DroneCam order={order} settings={settings} /></Suspense></div>
        </div> : <div className="kitchen-card">
          <div className="kitchen-food">{Object.keys(order.bag).slice(0, 3).map(id => { const item = menu.find(entry => entry.id === id); return item && <div key={id}><FoodArt kind={item.kind} /></div>; })}</div>
          <div><span className="eyebrow">IN THE KITCHEN</span><h2>Made fresh, <em>just for you.</em></h2><p>When your order is packed, {flight.droneId} takes over. You’ll be able to follow it overhead and through a live (simulated) camera.</p></div>
        </div>}
      </section>
      <aside className="status-summary">
        <div className="eyebrow">YOUR LITTLE DELIVERY</div>
        <ul>{Object.entries(order.bag).map(([id, quantity]) => { const item = menu.find(entry => entry.id === id); return <li key={id}><span>{quantity} × {item?.name}</span><strong>{money((item?.price || 0) * quantity)}</strong></li>; })}</ul>
        <div className="summary-total"><span>Total · {items} {items === 1 ? 'item' : 'items'}</span><strong>{money(bagTotal(order.bag))}</strong></div>
        <dl>
          <div><dt>Drone</dt><dd>{flight.droneId}</dd></div>
          <div><dt>From</dt><dd>Peninsula Kitchen, Main Street</dd></div>
          <div><dt>To</dt><dd>{dropOff.label}</dd></div>
          {order.stage === 'Delivering' && <div><dt>Distance left</dt><dd>{flight.remainingMetres} m</dd></div>}
        </dl>
        {order.stage !== 'Delivered' ? <button className="outline-button full-width" onClick={onAdvance}><FastForward size={14} />Skip to next stage (demo)</button>
          : <button className="primary-button full-width" onClick={onBack}>Order something else <ArrowRight size={15} /></button>}
        <p className="privacy-note"><ShieldCheck size={14} />Simulated order and flight. No payment, drone or camera is involved.</p>
      </aside>
    </div>
  </main>;
}
