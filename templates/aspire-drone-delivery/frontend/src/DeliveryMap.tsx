import { useEffect, useId, useRef, useState } from 'react';
import { Drone, Layers, MapPin, Minus, Plus } from 'lucide-react';
import type * as Atlas from 'azure-maps-control';
import type { Order, Point } from './demo';
import { demoFlights, kitchen, orderFlight } from './demo';
import { coastPath, landmarks, lakePath, landPath, mapLabels, parkPath, pierPath, roadPaths, routePaths, toLonLat } from './mapGeometry';

export type MapSettings = { clientId: string; token: string };
export type Flight = { id: string; x: number; y: number; status: string };

const position = (point: Point) => toLonLat(point.x, point.y);
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Customer-placed orders get a deterministic flight that joins the illustrative fleet while delivering. */
export function liveFlights(tick: number, orders: Order[]): Flight[] {
  return [...demoFlights(tick), ...orders.filter(order => order.customer === 'You' && order.stage === 'Delivering').slice(0, 1)
    .map(order => { const flight = orderFlight(order); return { id: flight.droneId, x: flight.x, y: flight.y, status: `Delivering ${order.id}` }; })];
}

export function AzureBasemap({ settings, flights, follow, route }: { settings: MapSettings; flights: Flight[]; follow?: Point; route?: Point }) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ map: Atlas.Map; atlas: typeof Atlas } | null>(null);
  const markers = useRef(new Map<string, Atlas.HtmlMarker>());
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const initialCenter = useRef(follow ?? kitchen);
  useEffect(() => {
    setReady(false);
    setError('');
    let map: Atlas.Map | undefined;
    let cancelled = false;
    import('azure-maps-control').then(atlas => {
      if (cancelled || !container.current) return;
      map = new atlas.Map(container.current, {
        center: position(initialCenter.current), zoom: follow ? 16 : 14, style: 'road', language: 'en-AU',
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
        store.textContent = 'ForthCoffee';
        map.markers.add(new atlas.HtmlMarker({ position: position(kitchen), htmlContent: store }));
        if (route) {
          const source = new atlas.source.DataSource();
          map.sources.add(source);
          source.add(new atlas.data.LineString([position(kitchen), position(route)]));
          map.layers.add(new atlas.layer.LineLayer(source, undefined, { strokeColor: '#184b38', strokeWidth: 3, strokeDashArray: [2, 2] }));
          const home = document.createElement('div');
          home.className = 'azure-store';
          home.textContent = 'Your drop-off';
          map.markers.add(new atlas.HtmlMarker({ position: position(route), htmlContent: home }));
        }
        mapRef.current = { map, atlas };
        setReady(true);
      });
    }).catch((reason: unknown) => {
      if (!cancelled) setError(`Map SDK could not load: ${reason instanceof Error ? reason.message : String(reason)}`);
    });
    return () => { cancelled = true; mapRef.current = null; markers.current.clear(); map?.dispose(); };
    // Recreate the map only when credentials or the map mode change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, Boolean(follow), route?.x, route?.y]);
  useEffect(() => {
    const current = mapRef.current;
    if (!ready || !current) return;
    const seen = new Set<string>();
    for (const flight of flights) {
      seen.add(flight.id);
      const existing = markers.current.get(flight.id);
      if (existing) { existing.setOptions({ position: position(flight) }); continue; }
      const element = document.createElement('div');
      element.className = 'azure-drone';
      element.textContent = flight.id;
      const marker = new current.atlas.HtmlMarker({ position: position(flight), htmlContent: element });
      current.map.markers.add(marker);
      markers.current.set(flight.id, marker);
    }
    for (const [id, marker] of markers.current) if (!seen.has(id)) { current.map.markers.remove(marker); markers.current.delete(id); }
  }, [flights, ready]);
  useEffect(() => {
    if (ready && follow) mapRef.current?.map.setCamera({ center: position(follow), type: reducedMotion() ? 'jump' : 'ease', duration: 900 });
  }, [follow?.x, follow?.y, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  return <><div className="azure-map" ref={container} aria-label="Azure Maps basemap of South Melbourne" />{!ready && !error && <div className="map-loading" role="status">Loading Azure Maps…</div>}{error && <div className="map-error" role="alert">{error}</div>}</>;
}

/** Illustrated South Melbourne artwork with per-instance pattern IDs. */
export function MapArtwork({ routes = true }: { routes?: boolean }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return <>
    <defs>
      <pattern id={`water-${id}`} width="40" height="40" patternUnits="userSpaceOnUse"><path d="M0 20 Q10 15 20 20 T40 20" fill="none" stroke="#bdd5d2" strokeWidth=".8" opacity=".5" /></pattern>
      <pattern id={`blocks-${id}`} width="56" height="66" patternUnits="userSpaceOnUse"><rect width="56" height="66" fill="#ebece3" /><rect x="5" y="5" width="44" height="54" rx="5" fill="#e3e5da" /><path d="M0 0H56V66" stroke="#fdfcf5" strokeWidth="5" fill="none" /></pattern>
      <clipPath id={`land-${id}`}><path d={landPath} /></clipPath>
    </defs>
    <rect x="-500" y="-500" width="2000" height="1650" fill="#c7ddda" /><rect x="-500" y="-500" width="2000" height="1650" fill={`url(#water-${id})`} />
    <g clipPath={`url(#land-${id})`}>
      <rect width="1000" height="650" fill={`url(#blocks-${id})`} />
      <path d={parkPath} fill="#d0dfbf" />
      <g stroke="#d2cbb5" strokeWidth="16" fill="none">{roadPaths.map(d => <path key={d} d={d} />)}</g>
      <g stroke="#fffdf3" strokeWidth="11" fill="none">{roadPaths.map(d => <path key={d} d={d} />)}</g>
      <path d={lakePath} fill="#c7ddda" />
      {routes && <path d={routePaths} fill="none" stroke="#729c85" strokeWidth="2" strokeDasharray="7 7" />}
    </g>
    <path d={coastPath} fill="none" stroke="#f5ecd1" strokeWidth="9" />
    <path d={pierPath} fill="none" stroke="#acb6a8" strokeWidth="5" />
    <g className="map-labels">
      <text x="875" y="590" className="water-subtitle">Albert Park Lake</text>
      {mapLabels.map(label => <text key={label.text + label.x} x={label.x} y={label.y} className={label.small ? 'small-map-label' : undefined}>{label.text}</text>)}
      <text x="620" y="308" className="street-label">COVENTRY STREET</text>
      <text x="590" y="210" transform="rotate(-90 590 210)" className="street-label">CLARENDON STREET</text>
    </g>
    {landmarks.map(({ x, y, label }) => <g key={label} transform={`translate(${x} ${y})`}>
      <circle r="16" fill="#fffaf0" stroke="#d7ddcb" /><MapPin x="-8" y="-8" width="16" height="16" color="#73816c" />
      <text y="32" textAnchor="middle" className="tiny-label">{label}</text>
    </g>)}
    <circle cx="510" cy="318" r="37" fill="#1e5a44" opacity=".08" /><circle cx="510" cy="318" r="24" fill="#184b38" stroke="#fff" strokeWidth="4" />
    <path d="M500 320V310H520V320M503 320V327H517V320M498 310L502 303H518L522 310Z" stroke="#fff" strokeWidth="2" fill="none" />
    <rect x="443" y="352" width="134" height="25" rx="12" fill="#fffdf5" /><text x="510" y="369" textAnchor="middle" className="store-label">ForthCoffee</text>
  </>;
}

export default function DeliveryMap({ tick, orders, settings, onSettings, compact = false }: {
  tick: number; orders: Order[]; settings: MapSettings | null; onSettings: () => void; compact?: boolean;
}) {
  const [zoom, setZoom] = useState(1);
  const flights = liveFlights(tick, orders);
  const active = orders.filter(order => order.stage !== 'Delivered').length;
  return <div className={`delivery-map ${compact ? 'compact' : ''}`}>
    {settings ? <AzureBasemap settings={settings} flights={flights} /> : <svg className="city-map" viewBox={compact ? '0 140 1000 340' : '0 0 1000 650'} preserveAspectRatio="xMidYMid slice" role="img" aria-label="Illustrated South Melbourne map with fictional ForthCoffee bar and simulated drone flights">
      <g transform={`translate(${500 - 500 * zoom} ${325 - 325 * zoom}) scale(${zoom})`}>
        <MapArtwork />
        {flights.map(flight => <g key={flight.id} transform={`translate(${flight.x} ${flight.y})`}>
          <circle r="22" fill="#fff" opacity=".65" /><circle r="16" fill="#fffdf7" stroke="#2b654d" strokeWidth="1.5" />
          <Drone x="-10" y="-10" width="20" height="20" color="#21553e" />
          <rect x="-28" y="24" width="56" height="18" rx="8" fill="#184b38" /><text y="36" textAnchor="middle" fill="#fff" className="drone-label">{flight.id}</text>
        </g>)}
      </g>
    </svg>}
    <div className="map-location"><span className="live-dot" /> South Melbourne, VIC <span className="map-location-detail">/ SIMULATED AIRSPACE</span></div>
    <button className="map-layers" onClick={onSettings}><Layers size={15} />{settings ? 'Azure Maps' : 'Map options'}</button>
    {!settings && <div className="map-zoom"><button aria-label="Zoom in on map" onClick={() => setZoom(value => Math.min(1.6, value + .2))}><Plus size={17} /></button><button aria-label="Zoom out on map" onClick={() => setZoom(value => Math.max(1, value - .2))}><Minus size={17} /></button></div>}
    {!compact && <div className="map-fleet"><div><span className="live-dot" /> FLEET AT A GLANCE</div><strong>{flights.length} drones. One small sky.</strong><p>{active} active orders · automatic demo flights</p><div className="fleet-avatars">{flights.map(flight => <span key={flight.id} title={`${flight.id}: ${flight.status}`}><Drone size={17} /></span>)}<small>All systems nominal</small></div></div>}
    <div className="map-credit">{settings ? 'Azure Maps · simulated positions' : 'Illustrated preview · approximate geography, not navigation'}</div>
  </div>;
}
