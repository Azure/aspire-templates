import { useEffect, useRef, useState } from 'react';
import { Drone, Layers, MapPin, Minus, Plus } from 'lucide-react';
import type * as Atlas from 'azure-maps-control';
import type { Order } from './demo';
import { demoFlights } from './demo';

export type MapSettings = { clientId: string; token: string };
type Flight = { id: string; x: number; y: number; status: string };

const position = (x: number, y: number) => [145.016 + x / 1000 * .048, -38.201 - y / 650 * .037];

function AzureBasemap({ settings, flights }: { settings: MapSettings; flights: Flight[] }) {
  const container = useRef<HTMLDivElement>(null);
  const markers = useRef<Atlas.HtmlMarker[]>([]);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(false);
    setError('');
    let map: Atlas.Map | undefined;
    let cancelled = false;
    import('azure-maps-control').then(atlas => {
      if (cancelled || !container.current) return;
      map = new atlas.Map(container.current, {
        center: position(510, 318), zoom: 14, style: 'road', language: 'en-AU',
        authOptions: {
          authType: atlas.AuthenticationType.anonymous,
          clientId: settings.clientId,
          getToken: resolve => resolve(settings.token),
        },
      });
      map.events.add('error', () => setError('Azure Maps could not load. Check the token, account permissions and network, or switch back to the illustrated map.'));
      map.events.add('ready', () => {
        if (!map || cancelled) return;
        map.controls.add(new atlas.control.ZoomControl(), { position: atlas.ControlPosition.TopRight });
        const store = document.createElement('div');
        store.className = 'azure-store';
        store.textContent = 'Peninsula Kitchen';
        map.markers.add(new atlas.HtmlMarker({ position: position(510, 318), htmlContent: store }));
        markers.current = [0, 1, 2, 3].map(i => {
          const element = document.createElement('div');
          element.className = 'azure-drone';
          element.textContent = `SKY-0${i + 1}`;
          return new atlas.HtmlMarker({ position: position(510, 318), htmlContent: element });
        });
        map.markers.add(markers.current);
        setReady(true);
      });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(`Map SDK could not load: ${reason instanceof Error ? reason.message : String(reason)}`);
    });
    return () => { cancelled = true; markers.current = []; map?.dispose(); };
  }, [settings]);
  useEffect(() => {
    if (ready) flights.forEach((flight, index) => markers.current[index]?.setOptions({ position: position(flight.x, flight.y) }));
  }, [flights, ready]);
  return <><div className="azure-map" ref={container} aria-label="Azure Maps basemap of Mornington" />{!ready && !error && <div className="map-loading" role="status">Loading Azure Maps…</div>}{error && <div className="map-error" role="alert">{error}</div>}</>;
}

export default function DeliveryMap({ tick, orders, settings, onSettings, compact = false }: {
  tick: number; orders: Order[]; settings: MapSettings | null; onSettings: () => void; compact?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const flights = demoFlights(tick);
  const active = orders.filter(order => order.stage !== 'Delivered').length;
  return <div className={`delivery-map ${compact ? 'compact' : ''}`}>
    {settings ? <AzureBasemap settings={settings} flights={flights} /> : <svg className="city-map" viewBox={compact ? '0 140 1000 340' : '0 0 1000 650'} preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustrated Mornington map with fictional stores and simulated drone flights">
      <defs>
        <pattern id="water" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M0 20 Q10 15 20 20 T40 20" fill="none" stroke="#bdd5d2" strokeWidth=".8" opacity=".5" /></pattern>
        <pattern id="blocks" width="56" height="66" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)"><rect width="56" height="66" fill="#ebece3" /><rect x="5" y="5" width="44" height="54" rx="5" fill="#e3e5da" /><path d="M0 0H56V66" stroke="#fdfcf5" strokeWidth="5" fill="none" /></pattern>
        <clipPath id="land"><path d="M530 -10 C490 60 461 91 430 120 L375 162 L400 196 L382 240 L338 281 L320 321 L335 359 L303 408 L290 451 L238 503 L211 550 L190 660 H1010 V-10Z" /></clipPath>
      </defs>
      <rect width="1000" height="650" fill="#c7ddda" /><rect width="1000" height="650" fill="url(#water)" />
      <g transform={`translate(${500 - 500 * zoom} ${325 - 325 * zoom}) scale(${zoom})`}>
        <g clipPath="url(#land)">
          <rect width="1000" height="650" fill="url(#blocks)" />
          <path d="M420 210 L490 199 L540 249 L501 282 L427 276Z M670 370 L750 352 L795 445 L705 472Z M382 437 L447 402 L483 461 L404 510Z M818 72L934 70L929 189L849 172Z" fill="#d0dfbf" />
          <g stroke="#d2cbb5" strokeWidth="16" fill="none"><path d="M355 227 L802 430 L1030 473" /><path d="M576 -30 L559 186 L608 350 L706 681" /><path d="M325 457 L636 323 L1013 157" /></g>
          <g stroke="#fffdf3" strokeWidth="11" fill="none"><path d="M355 227 L802 430 L1030 473" /><path d="M576 -30 L559 186 L608 350 L706 681" /><path d="M325 457 L636 323 L1013 157" /></g>
          <path d="M510 318 Q420 215 398 192 M510 318 Q646 205 681 108 M510 318 Q705 391 742 504" fill="none" stroke="#729c85" strokeWidth="2" strokeDasharray="7 7" />
        </g>
        <path d="M530 -10 C490 60 461 91 430 120 L375 162 L400 196 L382 240 L338 281 L320 321 L335 359 L303 408 L290 451 L238 503 L211 550 L190 660" fill="none" stroke="#f5ecd1" strokeWidth="9" />
        <path d="M391 191L328 158L308 175" fill="none" stroke="#acb6a8" strokeWidth="5" />
        <g className="map-labels">
          <text x="128" y="311" className="water-label">PORT PHILLIP</text>
          <text x="142" y="333" className="water-subtitle">A little closer, by air.</text>
          <text x="442" y="155">MORNINGTON</text>
          <text x="270" y="151" className="small-map-label">Mornington Pier</text>
          <text x="665" y="407" className="small-map-label">Alexandra Park</text>
          <text x="790" y="141" className="small-map-label">Mornington</text><text x="803" y="156" className="small-map-label">Golf Club</text>
          <text x="490" y="266" transform="rotate(24 490 266)" className="street-label">MAIN STREET</text>
          <text x="630" y="332" transform="rotate(-24 630 332)" className="street-label">NEPEAN HIGHWAY</text>
          <text x="290" y="532" className="small-map-label">Fishermans Beach</text>
        </g>
        {[[398, 192], [681, 108], [742, 504]].map(([x, y], i) => <g key={x} transform={`translate(${x} ${y})`}>
          <circle r="16" fill="#fffaf0" stroke="#d7ddcb" /><MapPin x="-8" y="-8" width="16" height="16" color="#73816c" />
          <text y="32" textAnchor="middle" className="tiny-label">{['The jetty', 'Garden stop', 'Beach house'][i]}</text>
        </g>)}
        <circle cx="510" cy="318" r="37" fill="#1e5a44" opacity=".08" /><circle cx="510" cy="318" r="24" fill="#184b38" stroke="#fff" strokeWidth="4" />
        <path d="M500 320V310H520V320M503 320V327H517V320M498 310L502 303H518L522 310Z" stroke="#fff" strokeWidth="2" fill="none" />
        <rect x="443" y="352" width="134" height="25" rx="12" fill="#fffdf5" /><text x="510" y="369" textAnchor="middle" className="store-label">Peninsula Kitchen</text>
        {flights.map(flight => <g key={flight.id} transform={`translate(${flight.x} ${flight.y})`}>
          <circle r="22" fill="#fff" opacity=".65" /><circle r="16" fill="#fffdf7" stroke="#2b654d" strokeWidth="1.5" />
          <Drone x="-10" y="-10" width="20" height="20" color="#21553e" />
          <rect x="-28" y="24" width="56" height="18" rx="8" fill="#184b38" /><text y="36" textAnchor="middle" fill="#fff" className="drone-label">{flight.id}</text>
        </g>)}
      </g>
    </svg>}
    <div className="map-location"><span className="live-dot" /> Mornington, VIC <span className="map-location-detail">/ SIMULATED AIRSPACE</span></div>
    <button className="map-layers" onClick={onSettings}><Layers size={15} />{settings ? 'Azure Maps' : 'Map options'}</button>
    {!settings && <div className="map-zoom"><button aria-label="Zoom in on map" onClick={() => setZoom(value => Math.min(1.6, value + .2))}><Plus size={17} /></button><button aria-label="Zoom out on map" onClick={() => setZoom(value => Math.max(1, value - .2))}><Minus size={17} /></button></div>}
    {!compact && <div className="map-fleet"><div><span className="live-dot" /> FLEET AT A GLANCE</div><strong>4 drones. One small sky.</strong><p>{active} active orders · automatic demo flights</p><div className="fleet-avatars">{flights.map(flight => <span key={flight.id} title={`${flight.id}: ${flight.status}`}><Drone size={17} /></span>)}<small>All systems nominal</small></div></div>}
    <div className="map-credit">{settings ? 'Azure Maps · simulated positions' : 'Illustrated preview · approximate geography, not navigation'}</div>
  </div>;
}
