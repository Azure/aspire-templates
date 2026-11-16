import type { CameraPose } from '../../frontend-shared/pose';

export type MenuItem = {
  id: string;
  name: string;
  detail: string;
  price: number;
  kind: 'coffee' | 'biscuit' | 'cake' | 'croissant';
  tag: string;
  units: number;
};

// Every item fills one whole payload bay (four units). These are demo packaging rules, not flight weights.
export const menu: MenuItem[] = [
  { id: 'flat-white', name: 'Flat white', detail: 'Double espresso, silky microfoam. A Melbourne essential.', price: 5, kind: 'coffee', tag: 'THE LOCAL FAVOURITE', units: 4 },
  { id: 'latte', name: 'Latte', detail: 'Our house espresso with a little more milk and a soft finish.', price: 5, kind: 'coffee', tag: 'SMOOTH & BALANCED', units: 4 },
  { id: 'cappuccino', name: 'Cappuccino', detail: 'Espresso, cloud-like foam and a dusting of cocoa.', price: 5, kind: 'coffee', tag: 'A LITTLE INDULGENCE', units: 4 },
  { id: 'long-black', name: 'Long black', detail: 'Hot water meets double espresso. Let the beans do the talking.', price: 4.5, kind: 'coffee', tag: 'BOLD & BRIGHT', units: 4 },
  { id: 'espresso', name: 'Espresso', detail: 'A small, beautifully concentrated moment. Our house blend.', price: 4, kind: 'coffee', tag: 'SMALL BUT MIGHTY', units: 4 },
  { id: 'biscuit', name: 'Choc-chip biscuit', detail: 'Golden edges, chocolate chunks. A very good coffee companion.', price: 3, kind: 'biscuit', tag: 'ONE BAY', units: 4 },
  { id: 'cake', name: 'Lemon drizzle cake', detail: 'A sunny slice of lemon cake with a tangy drizzle.', price: 6, kind: 'cake', tag: 'ONE BAY', units: 4 },
  { id: 'croissant', name: 'Butter croissant', detail: 'Flaky, golden and ready to make your morning.', price: 5.5, kind: 'croissant', tag: 'ONE BAY', units: 4 },
];

export const payloadSizes = [1, 2, 4] as const;
export type PayloadSize = typeof payloadSizes[number];
export const payloadNames: Record<PayloadSize, string> = { 1: 'Single', 2: 'Double', 4: 'Quad' };
export const coffeeSizes = ['Small', 'Regular', 'Large'] as const;
export const milkOptions = ['Full cream', 'Skim', 'Oat', 'Almond', 'Soy', 'None'] as const;
export const temperatures = ['Hot', 'Iced'] as const;
export type CoffeeOptions = {
  size: typeof coffeeSizes[number];
  milk: typeof milkOptions[number];
  shots: 1 | 2 | 3;
  sugar: 0 | 1 | 2;
  temperature: typeof temperatures[number];
};
export type BagLine = { id: string; itemId: string; quantity: number; coffee?: CoffeeOptions };
export type Bag = BagLine[];
export const menuItem = (id: string) => {
  const item = menu.find(entry => entry.id === id);
  if (!item) throw new Error(`Unknown menu item: ${id}`);
  return item;
};
export const defaultCoffee = (id: string): CoffeeOptions => ({
  size: 'Regular', milk: id === 'espresso' || id === 'long-black' ? 'None' : 'Full cream',
  shots: 2, sugar: 0, temperature: 'Hot',
});
const validCoffee = (options: CoffeeOptions) => coffeeSizes.includes(options.size) && milkOptions.includes(options.milk) &&
  temperatures.includes(options.temperature) && [1, 2, 3].includes(options.shots) && [0, 1, 2].includes(options.sugar);

export function makeLine(itemId: string, coffee?: CoffeeOptions): BagLine {
  const item = menuItem(itemId);
  if (item.kind !== 'coffee') {
    if (coffee) throw new Error('Only coffees can have coffee options.');
    return { id: itemId, itemId, quantity: 1 };
  }
  const options = coffee ?? defaultCoffee(itemId);
  if (!validCoffee(options)) {
    throw new Error('Choose a supported coffee size, milk, temperature, shot count and sugar.');
  }
  return { id: [itemId, options.size, options.milk, options.shots, options.sugar, options.temperature].join(':'), itemId, quantity: 1, coffee: { ...options } };
}

export function linePrice(line: BagLine) {
  const options = line.coffee;
  return menuItem(line.itemId).price + (options ? ({ Small: 0, Regular: .5, Large: 1 }[options.size] +
    (['Oat', 'Almond', 'Soy'].includes(options.milk) ? .8 : 0) + (options.shots === 3 ? .7 : 0)) : 0);
}
export const coffeeDescription = (options: CoffeeOptions) =>
  `${options.size} · ${options.temperature.toLowerCase()} · ${options.milk === 'None' ? 'no milk' : `${options.milk.toLowerCase()} milk`} · ${options.shots} shot${options.shots === 1 ? '' : 's'} · ${options.sugar ? `${options.sugar} sugar` : 'no sugar'}`;
export const bagCount = (bag: Bag) => bag.reduce((sum, line) => sum + line.quantity, 0);
export const bagUnits = (bag: Bag) => bag.reduce((sum, line) => sum + menuItem(line.itemId).units * line.quantity, 0);
export const bagTotal = (bag: Bag) => bag.reduce((sum, line) => sum + linePrice(line) * line.quantity, 0);
export const spaceLabel = (units: number) => `${units / 4} bay${units === 4 ? '' : 's'}`;

/** A payload's bays, in order. Each bay holds one coffee or one treat, or is empty. */
export type Bays = (BagLine | null)[];
export const emptyBays = (size: PayloadSize): Bays => Array.from({ length: size }, () => null);

export function bagFromBays(bays: Bays): Bag {
  const bag: Bag = [];
  for (const line of bays) {
    if (!line) continue;
    const existing = bag.find(entry => entry.id === line.id);
    if (existing) existing.quantity++;
    else bag.push({ ...line, quantity: 1, ...(line.coffee ? { coffee: { ...line.coffee } } : {}) });
  }
  return bag;
}

export function baysFromBag(bag: Bag, size: PayloadSize): Bays {
  const items = bag.flatMap(line => Array.from({ length: line.quantity }, () => ({ ...line, quantity: 1 })));
  if (items.length > size) throw new Error('These items need more bays. Choose a larger payload.');
  return [...items, ...emptyBays(size).slice(items.length)];
}

/** Resizes a payload, keeping each item in its bay when it still exists, otherwise packing items into the first free bays. */
export function resizeBays(bays: Bays, size: PayloadSize): Bays {
  const items = bays.filter((line): line is BagLine => line !== null);
  if (items.length > size) throw new Error('Remove some items before choosing a smaller payload.');
  if (bays.every((line, index) => !line || index < size)) return [...bays.slice(0, size), ...emptyBays(size).slice(bays.length)];
  return [...items, ...emptyBays(size).slice(items.length)];
}

export function validBag(bag: Bag, payload?: PayloadSize) {
  if (!bag.length || new Set(bag.map(line => line.id)).size !== bag.length) return false;
  if (!bag.every(line => {
    if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 9) return false;
    const item = menu.find(entry => entry.id === line.itemId);
    if (!item || (item.kind === 'coffee' ? !line.coffee || !validCoffee(line.coffee) : line.coffee !== undefined)) return false;
    return makeLine(line.itemId, line.coffee).id === line.id;
  })) return false;
  return payload === undefined || (payloadSizes.includes(payload) && bagUnits(bag) <= payload * 4);
}

export function addToBag(bag: Bag, line: BagLine, payload: PayloadSize): Bag {
  const existing = bag.find(entry => entry.id === line.id);
  const next = existing
    ? bag.map(entry => entry.id === line.id ? { ...entry, quantity: entry.quantity + line.quantity } : entry)
    : [...bag, line];
  if (!validBag(next, payload)) throw new Error('This item does not fit. Remove something or choose a larger payload.');
  return next;
}

export type Stage = 'Preparing' | 'Ready for pickup' | 'Delivering' | 'Delivered';
export type DroneAssignment = { id: string; pickupOrigin: Point; assignedAt: number };
export type Order = { id: string; customer: string; bag: Bag; payload: PayloadSize; stage: Stage; elapsed: number; manual: boolean; drone?: DroneAssignment; backend?: boolean; stageProgress?: number; tracking?: OrderFlight; pickup?: Destination; dropOff?: Destination; note?: string | null; etaSeconds?: number; photo?: { url: string; timestamp: string; proofOfDelivery: boolean }; cameraPose?: CameraPose; nearbyDrones?: CameraPose[]; failure?: string };
export type DemoState = { orders: Order[]; nextId: number; ticks: number; dronePads: Record<string, Point> };
export const initialState: DemoState = {
  nextId: 1044, ticks: 0,
  dronePads: { 'FC-05': { x: 742, y: 504 }, 'FC-06': { x: 620, y: 560 } },
  orders: [
    { id: 'FC-1041', customer: 'Alex M.', bag: [makeLine('flat-white'), makeLine('biscuit')], payload: 2, stage: 'Preparing', elapsed: 0, manual: false },
    { id: 'FC-1042', customer: 'Jess R.', bag: [makeLine('latte')], payload: 1, stage: 'Ready for pickup', elapsed: 0, manual: false, drone: { id: 'FC-05', pickupOrigin: { x: 742, y: 504 }, assignedAt: 0 } },
    { id: 'FC-1043', customer: 'Sam T.', bag: [makeLine('long-black'), makeLine('cake')], payload: 2, stage: 'Delivering', elapsed: 12, manual: false, drone: { id: 'FC-06', pickupOrigin: { x: 620, y: 560 }, assignedAt: 0 } },
  ],
};

export const stageTicks = { preparing: 20, ready: 30, pickupFlight: 24, flight: 35 } as const;
export const stages: Stage[] = ['Preparing', 'Ready for pickup', 'Delivering', 'Delivered'];
export const canPickup = (order: Order) => order.stage === 'Ready for pickup' && !!order.drone &&
  order.elapsed - order.drone.assignedAt >= stageTicks.pickupFlight;

function assignDrones(orders: Order[], dronePads: DemoState['dronePads']): Order[] {
  const occupied = new Set(orders.filter(order => order.stage !== 'Delivered').map(order => order.drone?.id));
  return orders.map(order => {
    if (order.stage !== 'Ready for pickup' || order.drone) return order;
    const id = ['FC-05', 'FC-06'].find(candidate => !occupied.has(candidate));
    if (!id) return order;
    occupied.add(id);
    const pickupOrigin = dronePads[id];
    return { ...order, drone: { id, pickupOrigin, assignedAt: order.elapsed } };
  });
}
export type Action = { type: 'tick' } | { type: 'confirm'; bag: Bag; payload: PayloadSize } | { type: 'pickup'; id: string } | { type: 'advance'; id: string } | { type: 'reset' };
export function demoReducer(state: DemoState, action: Action): DemoState {
  if (action.type === 'reset') return initialState;
  if (action.type === 'confirm') {
    if (!validBag(action.bag, action.payload)) throw new Error('An order must contain valid items that fit the selected payload.');
    return {
      ...state, nextId: state.nextId + 1,
      orders: [{ id: `FC-${state.nextId}`, customer: 'You', bag: action.bag.map(line => ({ ...line, ...(line.coffee ? { coffee: { ...line.coffee } } : {}) })), payload: action.payload, stage: 'Preparing', elapsed: 0, manual: true }, ...state.orders],
    };
  }
  if (action.type === 'pickup') return {
    ...state, orders: state.orders.map(order => order.id === action.id && canPickup(order) ? { ...order, stage: 'Delivering', elapsed: 0 } : order),
  };
  if (action.type === 'advance') {
    const orders = state.orders.map(order => order.id === action.id && order.stage !== 'Delivered' &&
      (order.stage !== 'Ready for pickup' || order.drone)
      ? { ...order, stage: stages[stages.indexOf(order.stage) + 1], elapsed: 0 } : order);
    const landed = orders.find(order => order.id === action.id && order.stage === 'Delivered' && order.drone);
    const dronePads = landed?.drone ? { ...state.dronePads, [landed.drone.id]: destinationFor(landed) } : state.dronePads;
    return { ...state, dronePads, orders: assignDrones(orders, dronePads) };
  }
  const ticks = state.ticks + 1;
  const dronePads = { ...state.dronePads };
  const orders = assignDrones(state.orders.map(order => {
    const elapsed = order.elapsed + 1;
    if (order.stage === 'Preparing' && elapsed >= stageTicks.preparing) return { ...order, stage: 'Ready for pickup' as const, elapsed: 0 };
    if (elapsed >= stageTicks.ready && canPickup({ ...order, elapsed })) return { ...order, stage: 'Delivering' as const, elapsed: 0 };
    if (order.stage === 'Delivering' && elapsed >= stageTicks.flight) {
      if (order.drone) dronePads[order.drone.id] = destinationFor(order);
      return { ...order, stage: 'Delivered' as const, elapsed: 0 };
    }
    return { ...order, elapsed };
  }).filter(order => order.stage !== 'Delivered' || order.manual || order.elapsed < 25).slice(0, 20), dronePads);
  if (ticks % 45 === 0 && orders.filter(order => order.stage !== 'Delivered').length < 8) {
    const item = menu[Math.floor(ticks / 45) % menu.length];
    orders.push({ id: `FC-${state.nextId}`, customer: ['Olivia W.', 'Charlie B.', 'Amelia L.'][Math.floor(ticks / 45) % 3], bag: [makeLine(item.id)], payload: 1, stage: 'Preparing', elapsed: 0, manual: false });
    return { orders, nextId: state.nextId + 1, ticks, dronePads };
  }
  return { ...state, orders, ticks, dronePads };
}

export const money = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(value);
export function demoFlights(tick: number) {
  return [0, 1, 2, 3].map(index => {
    const phase = ((tick + index * 23) % 120) / 120;
    const progress = phase < .12 ? 0 : phase < .5 ? (phase - .12) / .38 : (1 - phase) * 2;
    return { id: `FC-0${index + 1}`, x: 510 + Math.sin(index * 2) * 175 * progress, y: 318 + Math.cos(index * 1.8) * 210 * progress,
      status: phase < .12 ? 'Charging' : phase < .25 ? 'To pickup' : phase < .5 ? 'Delivering' : 'Returning' };
  });
}
export type Point = { x: number; y: number };
export const kitchen: Point = { x: 510, y: 318 };
export type Destination = Point & { label: string };
/** Demo drop-off points across South Melbourne. Each order is sent to one, so consecutive orders land somewhere different. */
export const dropOffs: Destination[] = [
  { x: 742, y: 504, label: 'Albert Park' },
  { x: 398, y: 192, label: 'South Melbourne Market' },
  { x: 440, y: 430, label: 'Dorcas Street' },
  { x: 788, y: 233, label: 'Kings Domain' },
  { x: 620, y: 560, label: 'Bridport Street' },
  { x: 860, y: 300, label: 'St Kilda Road' },
];
/** Each new order flies to a randomly chosen demo drop-off. */
export const randomDropOff = (random: () => number = Math.random): Destination => dropOffs[Math.min(dropOffs.length - 1, Math.floor(random() * dropOffs.length))];
export const destinationFor = (order: Pick<Order, 'id'>): Destination => dropOffs[Number(order.id.replace(/\D/g, '')) % dropOffs.length];
/** Illustrated-map units are roughly 4.2 m each across the South Melbourne demo area. */
export const metresPerUnit = 4.2;
const cruiseAltitude = 60;
/** Share of the flight spent climbing straight up at the bar, and descending straight down at the drop-off. */
export const verticalShare = .15;
/** Share of the flight spent swinging the camera between straight down and level, either side of the cruise. */
const cameraSwingShare = .06;
export type Manoeuvre = 'On the ground' | 'Vertical climb' | 'Cruise' | 'Vertical descent';
export type OrderFlight = Point & {
  droneId: string | null; phase: 'Awaiting drone' | 'To pickup' | 'On the pad' | 'In flight' | 'Landed'; manoeuvre: Manoeuvre;
  origin: Point; target: Destination;
  destination: Destination; progress: number; heading: number; altitude: number;
  /** Camera tilt below the horizon: 0 looks ahead, 1 looks straight down. */
  cameraDown: number; remainingMetres: number; etaSeconds: number;
};
const clamp = (value: number) => Math.min(1, Math.max(0, value));
const ease = (value: number) => value * value * (3 - 2 * value);
export function orderFlight(order: Order, fraction = 0): OrderFlight {
  if (order.tracking) return order.tracking;
  const destination = order.dropOff ?? destinationFor(order);
  if (order.backend) return {
    droneId: order.drone?.id ?? null, phase: 'Awaiting drone', manoeuvre: 'On the ground', origin: order.pickup ?? kitchen,
    target: destination, destination, progress: 0, heading: 0, x: 0, y: 0, altitude: 0, cameraDown: 0,
    remainingMetres: 0, etaSeconds: 0,
  };
  const inbound = order.stage === 'Ready for pickup' && !!order.drone;
  const origin = inbound && order.drone ? order.drone.pickupOrigin : kitchen;
  const target = inbound ? { ...kitchen, label: 'ForthCoffee pickup' } : destination;
  const dx = target.x - origin.x, dy = target.y - origin.y;
  const length = Math.hypot(dx, dy), heading = Math.atan2(dy, dx);
  const elapsed = Math.max(0, order.elapsed + clamp(fraction));
  const pickupElapsed = Math.max(0, elapsed - (order.drone?.assignedAt ?? elapsed));
  const progress = order.stage === 'Delivered' ? 1 : inbound ? clamp(pickupElapsed / stageTicks.pickupFlight)
    : order.stage === 'Delivering' ? Math.min(1, elapsed / stageTicks.flight) : 0;
  const flying = order.stage === 'Delivering' || (inbound && progress < 1);
  // Both legs climb vertically at their origin and descend vertically at their target.
  const travel = clamp((progress - verticalShare) / (1 - 2 * verticalShare));
  const altitude = !flying ? 0
    : progress < verticalShare ? cruiseAltitude * ease(progress / verticalShare)
    : progress > 1 - verticalShare ? cruiseAltitude * ease((1 - progress) / verticalShare) : cruiseAltitude;
  const manoeuvre: Manoeuvre = !flying ? 'On the ground'
    : progress < verticalShare ? 'Vertical climb' : progress > 1 - verticalShare ? 'Vertical descent' : 'Cruise';
  const cameraDown = order.stage === 'Delivered' || (inbound && progress === 1) ? 1
    : !flying ? 0
    : ease(clamp(Math.max(verticalShare + cameraSwingShare - progress, progress - (1 - verticalShare - cameraSwingShare)) / cameraSwingShare));
  const phase = !order.drone ? 'Awaiting drone' : inbound ? (progress < 1 ? 'To pickup' : 'On the pad')
    : order.stage === 'Delivering' ? 'In flight' : order.stage === 'Delivered' ? 'Landed' : 'Awaiting drone';
  const flightSecondsLeft = stageTicks.flight * (1 - progress);
  const etaSeconds = order.stage === 'Preparing' ? Math.max(0, stageTicks.preparing - elapsed) + stageTicks.ready + stageTicks.flight
    : order.stage === 'Ready for pickup' ? Math.max(0, stageTicks.ready - elapsed, stageTicks.pickupFlight - pickupElapsed) + stageTicks.flight : order.stage === 'Delivering' ? flightSecondsLeft : 0;
  return { droneId: order.drone?.id ?? null,
    phase, manoeuvre, origin, target, destination, progress, heading, x: origin.x + dx * travel, y: origin.y + dy * travel,
    altitude: Math.round(altitude), cameraDown,
    remainingMetres: Math.round(length * (1 - travel) * metresPerUnit), etaSeconds: Math.ceil(etaSeconds) };
}
