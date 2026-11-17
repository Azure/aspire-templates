import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { latLng, osmAttribution, osmMaxZoom, osmTileUrl } from './osm';
import type { Point } from './osm';

export type MapFlight = Point & { id: string; status: string; heading?: number; path?: Point[] };
export type MapPad = Point & { id: string; held?: boolean };
export type MapStore = Point & { label: string; pads?: MapPad[] };
export type MapRoute = { origin: Point; target: Point; targetLabel: string; current?: Point; path?: Point[] };

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const droneSvg = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="5" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/><path d="M7 7l3 3m4 0 3-3M7 17l3-3m4 0 3 3"/><rect x="10" y="10" width="4" height="4" rx="1"/></svg>';

function label(className: string, text: string) {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}

function droneIcon(flight: MapFlight) {
  const element = document.createElement('div');
  element.className = 'osm-drone';
  element.title = `${flight.id}: ${flight.status}`;
  const badge = document.createElement('span');
  badge.className = 'osm-drone-badge';
  badge.innerHTML = flight.heading === undefined ? droneSvg : '<svg viewBox="-14 -14 28 28" width="18" height="18" aria-hidden="true"><path d="M11 0 L-6 -8 L-2.5 0 L-6 8Z" fill="currentColor"/></svg>';
  element.append(badge, label('osm-drone-label', flight.id));
  return L.divIcon({ html: element, className: 'osm-marker', iconSize: [0, 0] });
}

function rotate(marker: L.Marker, heading?: number) {
  const svg = marker.getElement()?.querySelector<SVGElement>('.osm-drone-badge svg');
  if (svg && heading !== undefined) svg.style.transform = `rotate(${heading * 180 / Math.PI}deg)`;
}

function plannedPath(points: Point[], group: L.LayerGroup) {
  const path = points.map(latLng);
  L.polyline(path, { color: '#fffdf5', weight: 6, opacity: .8, interactive: false }).addTo(group);
  L.polyline(path, { color: '#b66b23', weight: 3, dashArray: '8 6', opacity: .9, interactive: false, className: 'osm-planned-route' }).addTo(group);
}

/** OpenStreetMap basemap (Leaflet) with themed drone, store and route overlays. */
export default function OsmMap({ flights, stores = [], route, follow, center, zoom = 15, fit, ariaLabel, onSelectDrone }: {
  flights: MapFlight[]; stores?: MapStore[]; route?: MapRoute; follow?: Point; center: Point; zoom?: number;
  /** Optional corners to fit on first render instead of the fixed zoom. */
  fit?: [Point, Point]; ariaLabel: string; onSelectDrone?: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layers = useRef<{ drones: Map<string, L.Marker>; stores: L.LayerGroup; route: L.LayerGroup; plans: L.LayerGroup } | null>(null);
  const initial = useRef({ center: follow ?? center, zoom, fit });

  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, { center: latLng(initial.current.center), zoom: initial.current.zoom, zoomControl: false, fadeAnimation: false, scrollWheelZoom: false, zoomAnimation: !reducedMotion() });
    L.control.zoom({ position: 'topright' }).addTo(instance);
    if (initial.current.fit) instance.fitBounds(L.latLngBounds(initial.current.fit.map(latLng)), { padding: [12, 12], maxZoom: initial.current.zoom, animate: false });
    instance.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
    L.tileLayer(osmTileUrl, { maxZoom: osmMaxZoom, attribution: osmAttribution, crossOrigin: true }).addTo(instance);
    layers.current = { drones: new Map(), stores: L.layerGroup().addTo(instance), route: L.layerGroup().addTo(instance), plans: L.layerGroup().addTo(instance) };
    map.current = instance;
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; layers.current = null; };
  }, []);

  useEffect(() => {
    const group = layers.current?.stores;
    if (!group) return;
    group.clearLayers();
    for (const store of stores) for (const pad of store.pads ?? [])
      L.circleMarker(latLng(pad), { radius: 4, weight: 1.5, color: '#184b38', fillColor: pad.held ? '#e9b44c' : '#fffdf5', fillOpacity: .95, interactive: false, className: pad.held ? 'osm-pad osm-pad-held' : 'osm-pad' }).addTo(group);
    for (const store of stores) L.marker(latLng(store), { icon: L.divIcon({ html: label('osm-store', store.label), className: 'osm-marker', iconSize: [0, 0] }), keyboard: false, title: store.label }).addTo(group);
  }, [stores]);

  useEffect(() => {
    const group = layers.current?.route;
    if (!group) return;
    group.clearLayers();
    if (!route) return;
    plannedPath(route.path ?? [route.origin, route.target], group);
    if (route.current && !route.path) L.polyline([latLng(route.origin), latLng(route.current)], { color: '#184b38', weight: 4, lineCap: 'round', interactive: false }).addTo(group);
    L.marker(latLng(route.target), { icon: L.divIcon({ html: label('osm-target', route.targetLabel), className: 'osm-marker', iconSize: [0, 0] }), keyboard: false, interactive: false }).addTo(group);
  }, [route?.origin.x, route?.origin.y, route?.target.x, route?.target.y, route?.targetLabel, route?.current?.x, route?.current?.y, route?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const group = layers.current?.plans;
    if (!group) return;
    group.clearLayers();
    for (const flight of flights) if (flight.path?.length) plannedPath(flight.path, group);
  }, [flights]);

  useEffect(() => {
    const current = layers.current, instance = map.current;
    if (!current || !instance) return;
    const seen = new Set<string>();
    for (const flight of flights) {
      seen.add(flight.id);
      let marker = current.drones.get(flight.id);
      if (marker) marker.setLatLng(latLng(flight));
      else {
        marker = L.marker(latLng(flight), { icon: droneIcon(flight), keyboard: !!onSelectDrone,
          title: onSelectDrone ? `Inspect drone ${flight.id}` : flight.id, zIndexOffset: 500 }).addTo(instance);
        current.drones.set(flight.id, marker);
      }
      marker.off('click keydown');
      if (onSelectDrone) {
        marker.on('click', () => onSelectDrone(flight.id));
        marker.on('keydown', (event: L.LeafletKeyboardEvent) => {
          if (event.originalEvent.key !== 'Enter' && event.originalEvent.key !== ' ') return;
          event.originalEvent.preventDefault();
          onSelectDrone(flight.id);
        });
      }
      if (onSelectDrone) marker.getElement()?.setAttribute('aria-label', `Inspect drone ${flight.id}`);
      const title = marker.getElement()?.querySelector<HTMLElement>('.osm-drone');
      if (title) title.title = `${flight.id}: ${flight.status}`;
      rotate(marker, flight.heading);
    }
    for (const [id, marker] of current.drones) if (!seen.has(id)) { marker.remove(); current.drones.delete(id); }
  }, [flights, onSelectDrone]);

  useEffect(() => {
    if (follow) map.current?.panTo(latLng(follow), { animate: !reducedMotion(), duration: .8 });
  }, [follow?.x, follow?.y]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="osm-map" ref={container} role="region" aria-label={ariaLabel} />;
}
