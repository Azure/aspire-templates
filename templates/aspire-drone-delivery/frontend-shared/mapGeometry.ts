// Shared illustrated-map geometry in a 1000 x 650 coordinate space.
export const mapSize = { width: 1000, height: 650 };
export const landPath = 'M-10-10H1010V660H-10Z';
export const lakePath = 'M870 431C821 444 799 489 810 531L901 660H1010V534C956 504 924 429 870 431Z';
export const coastPath = 'M870 431C821 444 799 489 810 531L901 660';
export const parkPath = 'M737 375L1010 471V660H871L747 520Z M266 95H362V177H266Z M597 52H686V135H597Z';
export const roadPaths = ['M-10 252H1010', 'M-10 318H1010', 'M-10 387H1010', 'M-10 456H707', 'M400-10V660', 'M600-10V660', 'M695-10L742 331L1010 493', 'M727 382L1010 570'];
export const pierPath = 'M853 453L873 467';
export const routePaths = 'M510 318 Q420 215 398 192 M510 318 Q646 205 681 108 M510 318 Q705 391 742 504';
export const landmarks = [
  { x: 398, y: 192, label: 'Market stop' },
  { x: 681, y: 108, label: 'Southbank stop' },
  { x: 742, y: 504, label: 'Albert Park' },
];
export const mapLabels = [
  { x: 410, y: 147, text: 'SOUTH MELBOURNE' },
  { x: 135, y: 531, text: 'PORT MELBOURNE', small: true },
  { x: 788, y: 233, text: 'Kings Domain', small: true },
  { x: 811, y: 404, text: 'Albert Park Reserve', small: true },
  { x: 803, y: 77, text: 'SOUTHBANK', small: true },
];

/** Approximate South Melbourne coordinates. The fictional bar is near Coventry Street, not a real shop. */
export const toLonLat = (x: number, y: number): [number, number] => [144.93232 + x / 1000 * .048, -37.81797 - y / 650 * .0295];
export const fromLonLat = (lon: number, lat: number) => ({ x: (lon - 144.93232) / .048 * 1000, y: (-37.81797 - lat) / .0295 * 650 });
