import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { MapSettings } from './DeliveryMap';
import type { Order } from './demo';
import { dropOff, kitchen, metresPerUnit, orderFlight } from './demo';
import { coastPath, fromLonLat, landmarks, lakePath, landPath, mapLabels, parkPath, pierPath, roadPaths, toLonLat } from './mapGeometry';

// Ground region (illustrated-map units) around the kitchen-to-drop-off corridor.
const region = { x: 380, y: 200, width: 500, height: 440 };
const tileZoom = 16;
type GroundSource = 'illustrated' | 'azure';

function drawIllustratedGround(ctx: CanvasRenderingContext2D, scale: number) {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.translate(-region.x, -region.y);
  ctx.fillStyle = '#c7ddda';
  ctx.fillRect(region.x, region.y, region.width, region.height);
  const land = new Path2D(landPath);
  ctx.save();
  ctx.clip(land);
  ctx.fillStyle = '#ebece3';
  ctx.fillRect(region.x, region.y, region.width, region.height);
  ctx.save();
  ctx.translate(region.x, region.y);
  ctx.fillStyle = '#e3e5da';
  for (let x = -300; x < 800; x += 56) for (let y = -300; y < 800; y += 66) ctx.fillRect(x + 5, y + 5, 44, 54);
  ctx.restore();
  ctx.fillStyle = '#d0dfbf';
  ctx.fill(new Path2D(parkPath));
  ctx.lineCap = 'round';
  for (const [color, width] of [['#d2cbb5', 16], ['#fffdf3', 11]] as const) {
    ctx.strokeStyle = color; ctx.lineWidth = width;
    roadPaths.forEach(path => ctx.stroke(new Path2D(path)));
  }
  ctx.fillStyle = '#c7ddda'; ctx.fill(new Path2D(lakePath));
  ctx.restore();
  ctx.strokeStyle = '#f5ecd1'; ctx.lineWidth = 9; ctx.stroke(new Path2D(coastPath));
  ctx.strokeStyle = '#acb6a8'; ctx.lineWidth = 5; ctx.stroke(new Path2D(pierPath));
  ctx.fillStyle = '#8b9b7c'; ctx.font = '11px "Segoe UI", sans-serif';
  mapLabels.forEach(label => ctx.fillText(label.text, label.x, label.y));
  landmarks.forEach(({ x, y }) => { ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fillStyle = '#fffaf0'; ctx.fill(); });
  ctx.restore();
}

function tileToLonLat(x: number, y: number) {
  const n = 2 ** tileZoom;
  return [x / n * 360 - 180, Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI] as const;
}
function lonLatToTile(lon: number, lat: number) {
  const n = 2 ** tileZoom, rad = lat * Math.PI / 180;
  return [Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * n)] as const;
}

/** Draws Azure Maps road tiles over the corridor. Throws if any tile fails so the caller can fall back to the illustrated ground. */
async function drawAzureGround(ctx: CanvasRenderingContext2D, scale: number, settings: MapSettings, signal: AbortSignal) {
  const [west, north] = toLonLat(region.x, region.y);
  const [east, south] = toLonLat(region.x + region.width, region.y + region.height);
  const [x0, y0] = lonLatToTile(west, north), [x1, y1] = lonLatToTile(east, south);
  const tiles: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
  if (tiles.length > 64) throw new Error('Too many tiles requested for the camera ground.');
  const queue = [...tiles];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let tile = queue.shift(); tile; tile = queue.shift()) {
      const [x, y] = tile;
      const url = new URL('https://atlas.microsoft.com/map/tile');
      Object.entries({ 'api-version': '2024-04-01', tilesetId: 'microsoft.base.road', zoom: String(tileZoom), x: String(x), y: String(y), tileSize: '256', language: 'en-AU' })
        .forEach(([key, value]) => url.searchParams.set(key, value));
      const response = await fetch(url, { signal, headers: { Authorization: `Bearer ${settings.token}`, 'x-ms-client-id': settings.clientId } });
      if (!response.ok) throw new Error(`Azure Maps tile request failed (${response.status}).`);
      const image = await createImageBitmap(await response.blob());
      const [lonA, latA] = tileToLonLat(x, y), [lonB, latB] = tileToLonLat(x + 1, y + 1);
      const a = fromLonLat(lonA, latA), b = fromLonLat(lonB, latB);
      ctx.drawImage(image, (a.x - region.x) * scale, (a.y - region.y) * scale, (b.x - a.x) * scale + 1, (b.y - a.y) * scale + 1);
      image.close();
    }
  }));
}

// Small deterministic generator so the temporary scenery is stable between visits.
function random(seed: number) {
  let value = seed;
  return () => { value = (value * 1664525 + 1013904223) % 4294967296; return value / 4294967296; };
}
function distanceToRoute(x: number, y: number) {
  const dx = dropOff.x - kitchen.x, dy = dropOff.y - kitchen.y;
  const t = Math.max(0, Math.min(1, ((x - kitchen.x) * dx + (y - kitchen.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - kitchen.x - dx * t, y - kitchen.y - dy * t);
}

function buildScenery(scene: THREE.Scene, disposables: { dispose(): void }[]) {
  const probe = document.createElement('canvas').getContext('2d');
  const land = new Path2D(landPath);
  const lake = new Path2D(lakePath);
  const onLand = (x: number, y: number) => probe ? probe.isPointInPath(land, x, y) && !probe.isPointInPath(lake, x, y) : true;
  const next = random(1046);
  const boxes: THREE.Matrix4[] = [], trees: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];
  const palette = ['#f2efe4', '#e6e1d2', '#d9d6c8', '#efe6d4', '#cfd8cc'].map(color => new THREE.Color(color));
  for (let i = 0; i < 1600 && boxes.length < 420; i++) {
    const x = region.x + next() * region.width, y = region.y + next() * region.height;
    if (!onLand(x, y) || Math.hypot(x - kitchen.x, y - kitchen.y) < 22 || Math.hypot(x - dropOff.x, y - dropOff.y) < 18 || distanceToRoute(x, y) < 10) continue;
    const tree = next() < .35;
    const matrix = new THREE.Matrix4();
    if (tree) {
      const size = 1.2 + next() * 1.6;
      matrix.compose(new THREE.Vector3(x, size, y), new THREE.Quaternion(), new THREE.Vector3(size, size * 2, size));
      trees.push(matrix);
    } else {
      const width = 3 + next() * 6, depth = 3 + next() * 6, height = 1.5 + next() * (next() < .08 ? 7 : 3.5);
      matrix.compose(new THREE.Vector3(x, height / 2, y), new THREE.Quaternion(), new THREE.Vector3(width, height, depth));
      boxes.push(matrix);
      colors.push(palette[Math.floor(next() * palette.length)]);
    }
  }
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1), boxMaterial = new THREE.MeshLambertMaterial();
  const buildings = new THREE.InstancedMesh(boxGeometry, boxMaterial, boxes.length);
  boxes.forEach((matrix, index) => { buildings.setMatrixAt(index, matrix); buildings.setColorAt(index, colors[index]); });
  const treeGeometry = new THREE.ConeGeometry(.5, 1, 7), treeMaterial = new THREE.MeshLambertMaterial({ color: '#6f9a6c' });
  const treeMesh = new THREE.InstancedMesh(treeGeometry, treeMaterial, trees.length);
  trees.forEach((matrix, index) => treeMesh.setMatrixAt(index, matrix));
  const padGeometry = new THREE.CylinderGeometry(3, 3, .2, 32), padMaterial = new THREE.MeshLambertMaterial({ color: '#184b38' });
  const pad = new THREE.Mesh(padGeometry, padMaterial); pad.position.set(kitchen.x, .15, kitchen.y);
  const targetGeometry = new THREE.RingGeometry(2.2, 3, 40), targetMaterial = new THREE.MeshLambertMaterial({ color: '#e9b44c', side: THREE.DoubleSide });
  const target = new THREE.Mesh(targetGeometry, targetMaterial); target.rotation.x = -Math.PI / 2; target.position.set(dropOff.x, .05, dropOff.y);
  scene.add(buildings, treeMesh, pad, target);
  disposables.push(boxGeometry, boxMaterial, treeGeometry, treeMaterial, padGeometry, padMaterial, targetGeometry, targetMaterial, buildings, treeMesh);
}

export default function DroneCam({ order, settings }: { order: Order; settings: MapSettings | null }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef({ order, changedAt: performance.now() });
  const [status, setStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
  const [ground, setGround] = useState<GroundSource>('illustrated');
  const [groundNote, setGroundNote] = useState('');
  useEffect(() => { latest.current = { order, changedAt: performance.now() }; }, [order]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'low-power' });
    } catch {
      setStatus('unavailable');
      return;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const disposables: { dispose(): void }[] = [];
    const controller = new AbortController();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute('aria-hidden', 'true');
    element.prepend(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dfe9e4');
    scene.fog = new THREE.Fog('#dfe9e4', 80, 230);
    scene.add(new THREE.HemisphereLight('#ffffff', '#9aa88c', 1.5));
    const sun = new THREE.DirectionalLight('#fff6e0', 1.3); sun.position.set(-1, 2, -.6); scene.add(sun);

    const scale = Math.min(6, renderer.capabilities.maxTextureSize / region.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(region.width * scale); canvas.height = Math.round(region.height * scale);
    const ctx = canvas.getContext('2d')!;
    drawIllustratedGround(ctx, scale);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const planeGeometry = new THREE.PlaneGeometry(region.width, region.height);
    planeGeometry.rotateX(-Math.PI / 2);
    const planeMaterial = new THREE.MeshLambertMaterial({ map: texture });
    const plane = new THREE.Mesh(planeGeometry, planeMaterial);
    plane.position.set(region.x + region.width / 2, 0, region.y + region.height / 2);
    scene.add(plane);
    disposables.push(texture, planeGeometry, planeMaterial);
    buildScenery(scene, disposables);
    if (settings) {
      drawAzureGround(ctx, scale, settings, controller.signal)
        .then(() => { texture.needsUpdate = true; setGround('azure'); setGroundNote(''); })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          drawIllustratedGround(ctx, scale);
          texture.needsUpdate = true;
          setGroundNote(`Azure Maps tiles unavailable, showing the illustrated map. ${error instanceof Error ? error.message : ''}`.trim());
        });
    }

    const camera = new THREE.PerspectiveCamera(62, 1, .5, 400);
    const resize = () => {
      const { clientWidth, clientHeight } = element;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(1, clientHeight);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    let frame = 0;
    const render = (now: number) => {
      const still = reduce.matches;
      const { order: current, changedAt } = latest.current;
      const flight = orderFlight(current, still ? 0 : (now - changedAt) / 1000);
      const forwardX = Math.cos(flight.heading), forwardZ = Math.sin(flight.heading);
      const t = now / 1000;
      const flying = flight.phase === 'In flight';
      const bob = still || !flying ? 0 : Math.sin(t * 2.1) * .25;
      const height = Math.max(3, flight.altitude / metresPerUnit) + bob;
      camera.position.set(flight.x - forwardX * 2, height, flight.y - forwardZ * 2);
      const lookAhead = flying ? 30 : 24;
      camera.lookAt(flight.x + forwardX * lookAhead, 0, flight.y + forwardZ * lookAhead);
      if (!still && flying) camera.rotateZ(Math.sin(t * .7) * .015);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    setStatus('live');

    return () => {
      controller.abort();
      cancelAnimationFrame(frame);
      observer.disconnect();
      disposables.forEach(item => item.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [settings]);

  const flight = orderFlight(order);
  return <div className="drone-cam" ref={host} role="img" aria-label={`Simulated camera view from drone ${flight.droneId}, ${flight.phase.toLowerCase()}. Not real video.`}>
    {status === 'unavailable' && <div className="cam-fallback"><strong>Camera preview unavailable</strong><p>This browser could not start WebGL. The overhead map still follows your drone.</p></div>}
    {status === 'loading' && <div className="cam-fallback" role="status">Starting simulated camera…</div>}
    <div className="cam-hud" aria-hidden="true">
      <span className="cam-rec"><i />SIMULATED FEED</span>
      <span className="cam-id">{flight.droneId} · CAM 1</span>
      <span className="cam-cross" />
      <span className="cam-readout">ALT {flight.altitude} m · {flight.phase === 'In flight' ? `${flight.remainingMetres} m to go` : flight.phase}</span>
    </div>
    <span className="cam-credit">{ground === 'azure' ? '© Microsoft, © TomTom · Azure Maps tiles · simulated view' : 'Illustrated ground · placeholder structures · not real video'}</span>
    {groundNote && <span className="cam-note" role="status">{groundNote}</span>}
  </div>;
}
