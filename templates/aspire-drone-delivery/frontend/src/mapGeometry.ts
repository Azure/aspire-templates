// Shared illustrated-map geometry in a 1000 × 650 coordinate space. Used by the SVG maps and the simulated camera texture.
export const mapSize = { width: 1000, height: 650 };
export const landPath = 'M530 -10 C490 60 461 91 430 120 L375 162 L400 196 L382 240 L338 281 L320 321 L335 359 L303 408 L290 451 L238 503 L211 550 L190 660 H1010 V-10Z';
export const coastPath = 'M530 -10 C490 60 461 91 430 120 L375 162 L400 196 L382 240 L338 281 L320 321 L335 359 L303 408 L290 451 L238 503 L211 550 L190 660';
export const parkPath = 'M420 210 L490 199 L540 249 L501 282 L427 276Z M670 370 L750 352 L795 445 L705 472Z M382 437 L447 402 L483 461 L404 510Z M818 72L934 70L929 189L849 172Z';
export const roadPaths = ['M355 227 L802 430 L1030 473', 'M576 -30 L559 186 L608 350 L706 681', 'M325 457 L636 323 L1013 157'];
export const pierPath = 'M391 191L328 158L308 175';
export const routePaths = 'M510 318 Q420 215 398 192 M510 318 Q646 205 681 108 M510 318 Q705 391 742 504';
export const landmarks = [
  { x: 398, y: 192, label: 'The jetty' },
  { x: 681, y: 108, label: 'Garden stop' },
  { x: 742, y: 504, label: 'Beach house' },
];
export const mapLabels = [
  { x: 442, y: 155, text: 'MORNINGTON' },
  { x: 270, y: 151, text: 'Mornington Pier', small: true },
  { x: 665, y: 407, text: 'Alexandra Park', small: true },
  { x: 790, y: 141, text: 'Mornington', small: true },
  { x: 803, y: 156, text: 'Golf Club', small: true },
  { x: 290, y: 532, text: 'Fishermans Beach', small: true },
];

/** Approximate conversion from illustrated-map units to WGS84 longitude/latitude for Mornington, Victoria. */
export const toLonLat = (x: number, y: number): [number, number] => [145.016 + x / 1000 * .048, -38.201 - y / 650 * .037];
export const fromLonLat = (lon: number, lat: number) => ({ x: (lon - 145.016) / .048 * 1000, y: (-38.201 - lat) / .037 * 650 });
