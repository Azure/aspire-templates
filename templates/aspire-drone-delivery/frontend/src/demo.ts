export type MenuItem = {
  id: string;
  name: string;
  detail: string;
  price: number;
  kind: 'burger' | 'pizza' | 'bowl' | 'taco';
  tag: string;
};

export const menu: MenuItem[] = [
  { id: 'burger', name: 'The Peninsula Burger', detail: 'Smash patty, aged cheddar, pickles & our house sauce.', price: 18.5, kind: 'burger', tag: 'LOCAL FAVOURITE' },
  { id: 'pizza', name: 'Basil & Burrata Pizza', detail: 'Wood-fired, San Marzano tomato & fresh basil.', price: 24, kind: 'pizza', tag: 'WOOD-FIRED' },
  { id: 'bowl', name: 'Green Coast Bowl', detail: 'Avocado, edamame, brown rice & sesame dressing.', price: 19, kind: 'bowl', tag: 'PLANT-BASED' },
  { id: 'taco', name: 'Baja Fish Tacos', detail: 'Crispy fish, lime slaw & a little coastal sunshine.', price: 21, kind: 'taco', tag: 'COASTAL CLASSIC' },
];

export type Bag = Record<string, number>;
export type Stage = 'Preparing' | 'Ready for pickup' | 'Delivering' | 'Delivered';
export type Order = { id: string; customer: string; bag: Bag; stage: Stage; elapsed: number; manual: boolean };
export type DemoState = { orders: Order[]; nextId: number; ticks: number };
export const initialState: DemoState = {
  nextId: 1044,
  ticks: 0,
  orders: [
    { id: 'SK-1041', customer: 'Alex M.', bag: { burger: 2 }, stage: 'Preparing', elapsed: 0, manual: false },
    { id: 'SK-1042', customer: 'Jess R.', bag: { pizza: 1 }, stage: 'Ready for pickup', elapsed: 0, manual: false },
    { id: 'SK-1043', customer: 'Sam T.', bag: { bowl: 1, taco: 1 }, stage: 'Delivering', elapsed: 12, manual: false },
  ],
};

export function bagTotal(bag: Bag) {
  return menu.reduce((sum, item) => sum + item.price * (bag[item.id] || 0), 0);
}

export function validBag(bag: Bag) {
  const entries = Object.entries(bag);
  return entries.length > 0 && entries.every(([id, count]) =>
    menu.some(item => item.id === id) && Number.isInteger(count) && count > 0 && count <= 9);
}

export const stageTicks = { preparing: 20, ready: 30, flight: 35 } as const;
export const stages: Stage[] = ['Preparing', 'Ready for pickup', 'Delivering', 'Delivered'];

export type Action = { type: 'tick' } | { type: 'confirm'; bag: Bag } | { type: 'pickup'; id: string } | { type: 'advance'; id: string } | { type: 'reset' };
export function demoReducer(state: DemoState, action: Action): DemoState {
  if (action.type === 'reset') return initialState;
  if (action.type === 'confirm') {
    if (!validBag(action.bag)) throw new Error('An order must contain known menu items with quantities from 1 to 9.');
    return {
      ...state, nextId: state.nextId + 1,
      orders: [{ id: `SK-${state.nextId}`, customer: 'You', bag: { ...action.bag }, stage: 'Preparing', elapsed: 0, manual: true }, ...state.orders],
    };
  }
  if (action.type === 'pickup') return {
    ...state, orders: state.orders.map(order => order.id === action.id && order.stage === 'Ready for pickup'
      ? { ...order, stage: 'Delivering', elapsed: 0 } : order),
  };
  if (action.type === 'advance') return {
    ...state, orders: state.orders.map(order => order.id === action.id && order.stage !== 'Delivered'
      ? { ...order, stage: stages[stages.indexOf(order.stage) + 1], elapsed: 0 } : order),
  };
  const ticks = state.ticks + 1;
  const orders = state.orders.map(order => {
    const elapsed = order.elapsed + 1;
    if (order.stage === 'Preparing' && elapsed >= stageTicks.preparing) return { ...order, stage: 'Ready for pickup' as const, elapsed: 0 };
    if (order.stage === 'Ready for pickup' && elapsed >= stageTicks.ready) return { ...order, stage: 'Delivering' as const, elapsed: 0 };
    if (order.stage === 'Delivering' && elapsed >= stageTicks.flight) return { ...order, stage: 'Delivered' as const, elapsed: 0 };
    return { ...order, elapsed };
  }).filter(order => order.stage !== 'Delivered' || order.manual || order.elapsed < 25).slice(0, 20);
  if (ticks % 45 === 0 && orders.filter(order => order.stage !== 'Delivered').length < 8) {
    const item = menu[Math.floor(ticks / 45) % menu.length];
    orders.push({ id: `SK-${state.nextId}`, customer: ['Olivia W.', 'Charlie B.', 'Amelia L.'][Math.floor(ticks / 45) % 3], bag: { [item.id]: 1 }, stage: 'Preparing', elapsed: 0, manual: false });
    return { orders, nextId: state.nextId + 1, ticks };
  }
  return { ...state, orders, ticks };
}

export function matchSpokenOrder(transcript: string): { bag: Bag; error?: string } {
  const input = transcript.trim().toLowerCase().replace(/[.,!?]/g, '');
  const bag: Bag = {};
  const quantities: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  const aliases: Record<string, string> = { burger: 'burger', burgers: 'burger', pizza: 'pizza', pizzas: 'pizza', bowl: 'bowl', bowls: 'bowl', taco: 'taco', tacos: 'taco' };
  const remaining = input.replace(/\b(a|an|one|two|three|four|five|six|seven|eight|nine|\d+)\s+(?:(?:the|peninsula|basil|burrata|green|coast|baja|fish)\s+)*(burgers?|pizzas?|bowls?|tacos?)\b/g,
    (_match, quantity: string, name: string) => {
      const id = aliases[name];
      bag[id] = (bag[id] || 0) + (quantities[quantity] ?? Number(quantity));
      return '';
    }).replace(/\b(please|and|can|i|have|would|like|order|me|could|you|get|thanks)\b/g, '').trim();
  if (remaining || !validBag(bag)) return { bag: {}, error: 'I need a little clarification. Try “two burgers and one bowl”. For changes or dietary requirements, please use the menu; this preview cannot interpret them safely.' };
  return { bag };
}

export const money = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value);

export function demoFlights(tick: number) {
  return [0, 1, 2, 3].map(index => {
    const phase = ((tick + index * 23) % 120) / 120;
    const progress = phase < .12 ? 0 : phase < .5 ? (phase - .12) / .38 : (1 - phase) * 2;
    return {
      id: `SKY-0${index + 1}`,
      x: 510 + Math.sin(index * 2) * 175 * progress,
      y: 318 + Math.cos(index * 1.8) * 210 * progress,
      status: phase < .12 ? 'Charging' : phase < .25 ? 'To pickup' : phase < .5 ? 'Delivering' : 'Returning',
    };
  });
}

export type Point = { x: number; y: number };
export const kitchen: Point = { x: 510, y: 318 };
export const dropOff: Point & { label: string } = { x: 742, y: 504, label: 'Your drop-off · Beach house' };
/** Illustrated-map units are roughly 4.2 m each across Mornington's 4.2 km wide demo area. */
export const metresPerUnit = 4.2;
const cruiseAltitude = 60;

export type OrderFlight = Point & {
  droneId: string;
  phase: 'Awaiting drone' | 'On the pad' | 'In flight' | 'Landed';
  progress: number;
  heading: number;
  altitude: number;
  remainingMetres: number;
  etaSeconds: number;
};

/**
 * Deterministic flight for one order: the assigned drone waits on Peninsula Kitchen's pad while the order is ready,
 * flies directly to the drop-off while delivering, then lands. `fraction` (0-1) interpolates within the current tick.
 */
export function orderFlight(order: Order, fraction = 0): OrderFlight {
  const dx = dropOff.x - kitchen.x, dy = dropOff.y - kitchen.y;
  const length = Math.hypot(dx, dy);
  const heading = Math.atan2(dy, dx);
  const elapsed = Math.max(0, order.elapsed + Math.min(1, Math.max(0, fraction)));
  const progress = order.stage === 'Delivered' ? 1 : order.stage === 'Delivering' ? Math.min(1, elapsed / stageTicks.flight) : 0;
  const climb = Math.min(1, progress / .15, (1 - progress) / .15);
  const phase = order.stage === 'Preparing' ? 'Awaiting drone' : order.stage === 'Ready for pickup' ? 'On the pad' : order.stage === 'Delivering' ? 'In flight' : 'Landed';
  const flightSecondsLeft = stageTicks.flight * (1 - progress);
  const etaSeconds = order.stage === 'Preparing' ? Math.max(0, stageTicks.preparing - elapsed) + stageTicks.ready + stageTicks.flight
    : order.stage === 'Ready for pickup' ? Math.max(0, stageTicks.ready - elapsed) + stageTicks.flight
    : order.stage === 'Delivering' ? flightSecondsLeft : 0;
  return {
    droneId: `SKY-${String(5 + Number(order.id.replace(/\D/g, '')) % 2).padStart(2, '0')}`,
    phase, progress, heading,
    x: kitchen.x + dx * progress,
    y: kitchen.y + dy * progress,
    altitude: order.stage === 'Delivering' ? Math.round(cruiseAltitude * Math.max(0, climb)) : 0,
    remainingMetres: Math.round(length * (1 - progress) * metresPerUnit),
    etaSeconds: Math.ceil(etaSeconds),
  };
}
