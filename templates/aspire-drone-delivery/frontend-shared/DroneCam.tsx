import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { PoseBuffer } from './pose';
import type { CameraPose } from './pose';
import './camera.css';
import { coastPath, fromLonLat, landmarks, lakePath, landPath, mapLabels, parkPath, pierPath, roadPaths } from './mapGeometry';
import { fetchTile, tilesFor, tileToLonLat } from './osm';

// Ground region (illustrated-map units) around the kitchen-to-drop-off corridor.
const region = { x: 280, y: 100, width: 720, height: 550 };
const kitchen = { x: 510, y: 318 };
const metresPerUnit = 4.2;
const tileZoom = 16;
type GroundSource = 'illustrated' | 'osm';

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

function drawAirspace(canvas: HTMLCanvasElement, readings: readonly CameraPose[], selectedId: string) {
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return 0;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const scale = Math.min(canvas.width / region.width, canvas.height / region.height);
  const offsetX = (canvas.width - region.width * scale) / 2;
  const offsetY = (canvas.height - region.height * scale) / 2;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.translate(offsetX, offsetY);
  drawIllustratedGround(ctx, scale);
  ctx.restore();
  let count = 0;
  for (const reading of readings) {
    if (Date.now() - Date.parse(reading.timestamp) > 30000) continue;
    const point = fromLonLat(reading.position.longitude, reading.position.latitude);
    if (point.x < region.x || point.x > region.x + region.width || point.y < region.y || point.y > region.y + region.height) continue;
    count++;
    const x = offsetX + (point.x - region.x) * scale;
    const y = offsetY + (point.y - region.y) * scale;
    const color = reading.droneId === selectedId ? '#c47b2d' : '#184b38';
    const markerSize = Math.max(1, ratio);
    ctx.beginPath();
    ctx.arc(x, y, 5 * markerSize, 0, Math.PI * 2);
    ctx.fillStyle = '#fffef5';
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = markerSize;
    ctx.stroke();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(reading.heading * Math.PI / 180);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * markerSize;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -4 * markerSize);
    ctx.lineTo(-3 * markerSize, 3 * markerSize);
    ctx.moveTo(0, -4 * markerSize);
    ctx.lineTo(3 * markerSize, 3 * markerSize);
    ctx.moveTo(-3 * markerSize, 0);
    ctx.lineTo(3 * markerSize, 0);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, -4 * markerSize);
    ctx.lineTo(-2 * markerSize, 2 * markerSize);
    ctx.lineTo(2 * markerSize, 2 * markerSize);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  return count;
}

/** Draws OpenStreetMap tiles over the corridor (fetched once per page). Throws if any tile fails so the caller can keep the illustrated ground. */
async function drawOsmGround(ctx: CanvasRenderingContext2D, scale: number, signal: AbortSignal) {
  const queue = tilesFor(region, tileZoom);
  // Draw only after every tile arrives so a partial failure never leaves a patchwork ground.
  const images: { x: number; y: number; image: ImageBitmap }[] = [];
  try {
    await Promise.all(Array.from({ length: 2 }, async () => {
      for (let tile = queue.shift(); tile; tile = queue.shift()) {
        const [x, y] = tile;
        const blob = await fetchTile(tileZoom, x, y);
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        images.push({ x, y, image: await createImageBitmap(blob) });
      }
    }));
    for (const { x, y, image } of images) {
      const [lonA, latA] = tileToLonLat(x, y, tileZoom), [lonB, latB] = tileToLonLat(x + 1, y + 1, tileZoom);
      const a = fromLonLat(lonA, latA), b = fromLonLat(lonB, latB);
      ctx.drawImage(image, (a.x - region.x) * scale, (a.y - region.y) * scale, (b.x - a.x) * scale + 1, (b.y - a.y) * scale + 1);
    }
  } finally {
    images.forEach(({ image }) => image.close());
  }
}

// Small deterministic generator so the temporary scenery is stable between visits.
function random(seed: number) {
  let value = seed;
  return () => { value = (value * 1664525 + 1013904223) % 4294967296; return value / 4294967296; };
}

function buildScenery(scene: THREE.Scene, disposables: { dispose(): void }[]): THREE.Mesh {
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
    if (!onLand(x, y) || Math.hypot(x - kitchen.x, y - kitchen.y) < 22) continue;
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
  const target = new THREE.Mesh(targetGeometry, targetMaterial); target.rotation.x = -Math.PI / 2; scene.add(buildings, treeMesh, pad, target);
  disposables.push(boxGeometry, boxMaterial, treeGeometry, treeMaterial, padGeometry, padMaterial, targetGeometry, targetMaterial, buildings, treeMesh);
  return target;
}

function droneModel(id: string, selected: boolean, disposables: { dispose(): void }[]) {
  const group = new THREE.Group();
  const body = new THREE.BoxGeometry(1.1, .35, 1.5);
  const arm = new THREE.BoxGeometry(2.5, .12, .12);
  const rotor = new THREE.CylinderGeometry(.65, .65, .035, 16);
  const shell = new THREE.MeshLambertMaterial({ color: selected ? '#c47b2d' : '#184b38' });
  const metal = new THREE.MeshLambertMaterial({ color: '#e9b44c' });
  const blades = new THREE.MeshBasicMaterial({ color: '#647a6d', transparent: true, opacity: .48, side: THREE.DoubleSide });
  group.add(new THREE.Mesh(body, shell));
  for (const z of [-.65, .65]) {
    const beam = new THREE.Mesh(arm, metal); beam.position.z = z; group.add(beam);
    for (const x of [-1.25, 1.25]) {
      const disk = new THREE.Mesh(rotor, blades); disk.position.set(x, .12, z); group.add(disk);
    }
  }
  // The gold nose points north (-Z), matching headings in the simulator.
  const nose = new THREE.Mesh(new THREE.BoxGeometry(.8, .2, .15), metal);
  nose.position.z = -.8; group.add(nose);
  const label = document.createElement('canvas');
  label.width = 256; label.height = 48;
  const ink = label.getContext('2d')!;
  ink.fillStyle = '#184b38'; ink.fillRect(0, 0, 256, 48);
  ink.fillStyle = '#fffdf5'; ink.font = '28px monospace'; ink.textAlign = 'center';
  ink.fillText(id, 128, 34);
  const texture = new THREE.CanvasTexture(label);
  const captionMaterial = new THREE.SpriteMaterial({ map: texture, sizeAttenuation: false });
  const caption = new THREE.Sprite(captionMaterial); caption.scale.set(.38, .075, 1); caption.position.y = 1.8;
  group.add(caption);
  const markerGeometry = new THREE.RingGeometry(5, 8, 24);
  const markerMaterial = new THREE.MeshBasicMaterial({ color: selected ? '#c47b2d' : '#184b38', side: THREE.DoubleSide });
  const marker = new THREE.Mesh(markerGeometry, markerMaterial);
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = .12;
  group.add(marker);
  group.scale.setScalar(.35);
  disposables.push(body, arm, rotor, shell, metal, blades, nose.geometry, markerGeometry, markerMaterial);
  disposables.push(texture, captionMaterial);
  return group;
}

export default function DroneCam({ pose, nearby = [], target: destination }: {
  pose: CameraPose; nearby?: readonly CameraPose[]; target?: { x: number; y: number };
}) {
  const host = useRef<HTMLDivElement>(null);
  const buffers = useRef(new Map<string, PoseBuffer>());
  const latest = useRef({ pose, nearby, destination });
  const [status, setStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
  const [ground, setGround] = useState<GroundSource>('illustrated');
  const [groundNote, setGroundNote] = useState('');
  useEffect(() => {
    latest.current = { pose, nearby, destination };
    const visible = new Set([pose.droneId, ...nearby.map(drone => drone.droneId)]);
    for (const id of buffers.current.keys()) if (!visible.has(id)) buffers.current.delete(id);
    for (const reading of [pose, ...nearby]) {
      let buffer = buffers.current.get(reading.droneId);
      if (!buffer) { buffer = new PoseBuffer(); buffers.current.set(reading.droneId, buffer); }
      buffer.push(reading);
    }
    const canvas = host.current?.querySelector<HTMLCanvasElement>('.cam-airspace canvas');
    const count = canvas ? drawAirspace(canvas, [pose, ...nearby], pose.droneId) : 0;
    const label = host.current?.querySelector<HTMLElement>('.cam-airspace-label');
    if (label && label.dataset.count !== String(count)) {
      label.dataset.count = String(count);
      label.textContent = `AIRSPACE · ${count} DRONES`;
    }
  }, [pose, nearby, destination]);

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
    const target = buildScenery(scene, disposables);
    target.visible = false;
    const models = new Map<string, THREE.Group>();
    const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4();
    drawOsmGround(ctx, scale, controller.signal)
      .then(() => { texture.needsUpdate = true; setGround('osm'); setGroundNote(''); })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setGroundNote(`OpenStreetMap tiles unavailable, showing the illustrated ground. ${error instanceof Error ? error.message : ''}`.trim());
      });

    const camera = new THREE.PerspectiveCamera(62, 1, .5, 400);
    const resize = () => {
      const { clientWidth, clientHeight } = element;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(1, clientHeight);
      camera.updateProjectionMatrix();
      const canvas = element.querySelector<HTMLCanvasElement>('.cam-airspace canvas');
      const count = canvas ? drawAirspace(canvas, [latest.current.pose, ...latest.current.nearby], latest.current.pose.droneId) : 0;
      const label = element.querySelector<HTMLElement>('.cam-airspace-label');
      if (label && label.dataset.count !== String(count)) {
        label.dataset.count = String(count);
        label.textContent = `AIRSPACE · ${count} DRONES`;
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    let frame = 0;
    const render = () => {
      const still = reduce.matches;
      const { pose: current, nearby: others, destination: goal } = latest.current;
      target.visible = !!goal;
      if (goal) target.position.set(goal.x, .05, goal.y);
      const at = still ? Date.now() : Date.now() - 2000;
      const sampled = buffers.current.get(current.droneId)?.sample(at) ?? current;
      const location = fromLonLat(sampled.position.longitude, sampled.position.latitude);
      const heading = (sampled.heading - 90) * Math.PI / 180;
      const forwardX = Math.cos(heading), forwardZ = Math.sin(heading);
      const height = Math.max(.7, sampled.altitudeMetres / metresPerUnit);
      camera.position.set(location.x, height, location.y);
      const tilt = -sampled.cameraPitchDegrees * Math.PI / 180;
      const down = Math.sin(tilt), across = Math.cos(tilt);
      camera.up.set(forwardX * down, across, forwardZ * down);
      camera.lookAt(location.x + forwardX * across, height - down, location.y + forwardZ * across);
      const seen = new Set<string>();
      for (const reading of others.slice(0, 24)) {
        if (Date.now() - Date.parse(reading.timestamp) > 30000) continue;
        const other = buffers.current.get(reading.droneId)?.sample(at);
        if (!other) continue;
        seen.add(other.droneId);
        let model = models.get(other.droneId);
        if (!model) { model = droneModel(other.droneId, other.droneId === current.droneId, disposables); models.set(other.droneId, model); scene.add(model); }
        const point = fromLonLat(other.position.longitude, other.position.latitude);
        model.position.set(point.x, Math.max(.25, other.altitudeMetres / metresPerUnit), point.y);
        model.rotation.y = -other.heading * Math.PI / 180;
        model.scale.setScalar(.35);
        // The simulator permits co-located launch pads; do not render a hull around the camera lens.
        model.visible = camera.position.distanceTo(model.position) > 1;
      }
      for (const [id, model] of models) if (!seen.has(id)) model.visible = false;
      camera.updateMatrixWorld();
      scene.updateMatrixWorld();
      frustum.setFromProjectionMatrix(viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      element.dataset.visibleDrones = String([...models.values()].filter(model => model.visible &&
        camera.position.distanceTo(model.position) < 230 && frustum.intersectsObject(model.children[0])).length);
      element.dataset.otherDrones = String([...seen].filter(id => id !== current.droneId).length);
      element.dataset.heading = sampled.heading.toFixed(2);
      element.dataset.altitude = sampled.altitudeMetres.toFixed(2);
      element.dataset.cameraPitch = sampled.cameraPitchDegrees.toFixed(2);
      element.dataset.airspaceDrones = element.querySelector('.cam-airspace-label')?.getAttribute('data-count') ?? '0';
      const stale = Date.now() - Date.parse(current.timestamp) > 10000;
      element.dataset.stale = String(stale);
      const readout = element.querySelector('.cam-readout');
      if (readout) readout.textContent = stale ? 'TELEMETRY PAUSED · LAST RECEIVED POSE'
        : `ALT ${sampled.altitudeMetres.toFixed(1)} m · HDG ${sampled.heading.toFixed(0)}° · CAM ${sampled.cameraPitchDegrees.toFixed(0)}°`;
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, element.clientWidth, element.clientHeight);
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
  }, []);

  return <div className="drone-cam" ref={host} role="img" aria-label={`Simulated camera view from drone ${pose.droneId}, with an airspace overview of actual telemetry positions. Not real video.`}>
    {status === 'unavailable' && <div className="cam-fallback"><strong>Camera preview unavailable</strong><p>This browser could not start WebGL. The overhead map still follows your drone.</p></div>}
    {status === 'loading' && <div className="cam-fallback" role="status">Starting simulated camera…</div>}
    <div className="cam-hud" aria-hidden="true">
      <span className="cam-rec"><i />SIMULATED FEED</span>
      <span className="cam-id">{pose.droneId} · CAM 1</span>
      <span className="cam-cross" />
      <span className="cam-readout" />
    </div>
    <div className="cam-transmission" aria-hidden="true" />
    <div className="cam-airspace"><canvas aria-hidden="true" /><span className="cam-airspace-label">AIRSPACE</span></div>
    <span className="cam-credit">{ground === 'osm' ? '© OpenStreetMap contributors · placeholder structures' : 'Illustrated ground · placeholder structures'} · ~2 s playout · not video</span>
    {groundNote && <span className="cam-note" role="status">{groundNote}</span>}
  </div>;
}
