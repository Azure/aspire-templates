import { afterEach, expect, test, vi } from 'vitest';
import OsmMap from '../../frontend-shared/OsmMap';

const state = vi.hoisted(() => ({
  effects: [] as (() => void)[], refs: [] as { current: unknown }[], cursor: 0,
  markers: [] as {
    options: { keyboard: boolean; title: string };
    click?: () => void; remove: ReturnType<typeof vi.fn>;
    addTo(): unknown; setLatLng(): void; getElement(): undefined;
    off(): void; on(event: string, handler: () => void): void;
  }[],
}));
vi.mock('react', () => ({
  useRef: (initial: unknown) => state.refs[state.cursor++] ??= { current: initial },
  useEffect: (effect: () => void) => state.effects.push(effect),
}));
vi.mock('leaflet', () => ({
  default: {
    map: () => ({ attributionControl: { setPrefix() {} }, invalidateSize() {}, remove() {} }),
    control: { zoom: () => ({ addTo() {} }) },
    tileLayer: () => ({ addTo() {} }),
    layerGroup: () => ({ addTo() { return this; }, clearLayers() {} }),
    divIcon: (options: unknown) => options,
    marker: (_point: unknown, options: { keyboard: boolean; title: string }) => {
      const marker = {
        options, click: undefined as (() => void) | undefined, remove: vi.fn(),
        addTo() { return this; }, setLatLng() {}, getElement() { return undefined; },
        off() { this.click = undefined; }, on(event: string, handler: () => void) { if (event === 'click') this.click = handler; },
      };
      state.markers.push(marker);
      return marker;
    },
  },
}));

afterEach(() => {
  state.effects = []; state.refs = []; state.markers = []; state.cursor = 0;
  vi.unstubAllGlobals();
});

test('map markers select their own drone, keep working after telemetry updates and detach when removed', () => {
  vi.stubGlobal('document', { createElement: () => ({ append() {} }) });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const flights = [
    { id: 'PIC-01', x: 510, y: 318, status: 'Cruise' },
    { id: 'DOP-02', x: 530, y: 320, status: 'Loading' },
  ];
  const select = vi.fn(), nextSelect = vi.fn();
  function render(currentFlights = flights, onSelectDrone: (id: string) => void = select) {
    state.cursor = 0; state.effects = [];
    OsmMap({ flights: currentFlights, center: { x: 510, y: 318 }, ariaLabel: 'Fleet', onSelectDrone });
  }
  render();
  state.refs[0].current = {};
  state.effects.forEach(effect => effect());
  expect(state.markers[0].options).toMatchObject({ keyboard: true, title: 'Inspect drone PIC-01' });
  state.markers[1].click?.();
  expect(select).toHaveBeenCalledExactlyOnceWith('DOP-02');

  render(flights.map(flight => ({ ...flight, x: flight.x + 1 })), nextSelect);
  // Only rerun the drone-update effect, keeping the existing Leaflet instance and markers.
  state.effects[4]();
  expect(state.markers).toHaveLength(2);
  state.markers[0].click?.();
  expect(nextSelect).toHaveBeenCalledExactlyOnceWith('PIC-01');
  expect(select).toHaveBeenCalledTimes(1);

  render([flights[0]], nextSelect);
  state.effects[4]();
  expect(state.markers[1].remove).toHaveBeenCalledOnce();
});
