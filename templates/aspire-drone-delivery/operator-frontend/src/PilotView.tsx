import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { CamPad } from '../../frontend-shared/DroneCam';
import { manualControl, sendManualInput } from './api';
import type { ManualAction, Telemetry } from './api';
import type { DroneAudio } from './droneAudio';
import { airspaceFrom, controlKeys, hover, inputFromKeys, lookFromPointer, ManualPredictor, speedOf, startState } from './manualFlight';

const DroneCam = lazy(() => import('../../frontend-shared/DroneCam'));
const sendIntervalMs = 100;

export type PilotOutcome = { message: string; failed?: boolean };

/**
 * The expanded take-control feed. Keys and the cursor drive the simulator through ~10 Hz input posts; the view renders a
 * local prediction of the same flight model, reconciled with the simulator's acknowledged telemetry.
 */
export default function PilotView({ drone, fleet, pads, sessionId, audio, onEnd }: {
  drone: Telemetry; fleet: Telemetry[]; pads: CamPad[]; sessionId: string; audio: DroneAudio; onEnd: (outcome: PilotOutcome) => void;
}) {
  const predictor = useRef(new ManualPredictor(startState(drone), drone.class));
  const keys = useRef(new Set<string>());
  const look = useRef({ cameraPitchDegrees: -30, cameraYawDegrees: 0 });
  const paused = useRef(false);
  const sequence = useRef(0);
  const feed = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState(false);
  const [handing, setHanding] = useState<ManualAction | null>(null);
  const [error, setError] = useState('');
  const [linkIssue, setLinkIssue] = useState(false);
  const [readout, setReadout] = useState({ speed: 0, altitude: drone.altitudeMetres, heading: drone.heading });
  const end = useRef(onEnd);
  end.current = onEnd;
  const droneId = drone.droneId;

  const input = useCallback(() => paused.current ? hover(look.current) : inputFromKeys(keys.current, look.current), []);
  const send = useCallback(() => {
    const next = ++sequence.current;
    predictor.current.recordSend(next, Date.now());
    sendManualInput(droneId, sessionId, next, input())
      .then(ok => setLinkIssue(!ok)).catch(() => setLinkIssue(true));
  }, [droneId, sessionId, input]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([import('../../frontend-shared/osm-buildings.json'), import('../../frontend-shared/buildings')])
      .then(([{ default: data }, { decodeBuildings }]) => { if (!cancelled) predictor.current.airspace = airspaceFrom(decodeBuildings(data)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // Reconcile with each authoritative reading and leave when the simulator releases (or refuses) control.
  useEffect(() => {
    const manual = drone.manual;
    if (!manual || manual.sessionId !== sessionId) return;
    if (manual.status === 'Released' || manual.status === 'Rejected') {
      end.current({ message: manual.message, failed: manual.status === 'Rejected' });
      return;
    }
    const error = predictor.current.reconcile(drone);
    if (feed.current && error !== null) feed.current.dataset.reconcileError = error.toFixed(2);
    if (feed.current) feed.current.dataset.status = manual.status;
  }, [drone, sessionId]);

  useEffect(() => {
    const clear = () => { if (keys.current.size) { keys.current.clear(); send(); } };
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Escape' || event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (handing) return;
        keys.current.clear();
        paused.current = !paused.current;
        setPrompt(paused.current);
        send();
        return;
      }
      if (event.key === 'Tab') return;
      if (!controlKeys.has(event.code) && !event.code.startsWith('Arrow')) return;
      // Space and arrows would scroll the page; Shift is also captured so the drawer never sees flight keys.
      event.preventDefault(); event.stopPropagation();
      if (paused.current || event.repeat || !controlKeys.has(event.code)) return;
      keys.current.add(event.code);
      send();
    };
    const up = (event: KeyboardEvent) => {
      if (!controlKeys.has(event.code)) return;
      event.preventDefault(); event.stopPropagation();
      if (keys.current.delete(event.code)) send();
    };
    const visibility = () => { if (document.hidden) clear(); };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [send, handing]);

  useEffect(() => {
    send();
    const timer = window.setInterval(send, sendIntervalMs);
    let frame = 0, last = performance.now(), shown = 0;
    const tick = (now: number) => {
      const seconds = Math.min(.1, Math.max(0, (now - last) / 1000));
      last = Math.max(last, now);
      const current = input();
      predictor.current.advance(current, seconds, Date.now());
      const state = predictor.current.state;
      audio.update(.3 * Math.min(1, speedOf(state) / 14) + .45 * Math.max(0, current.vertical) + .15 * Math.abs(current.yaw)
        + .1 * Math.hypot(state.pitch, state.roll) / 14);
      if (now - shown > 200) {
        shown = now;
        setReadout({ speed: speedOf(state), altitude: state.altitude, heading: state.heading });
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => { window.clearInterval(timer); cancelAnimationFrame(frame); };
  }, [send, input, audio]);

  useEffect(() => { feed.current?.focus(); }, []);

  const live = useCallback(() => predictor.current.pose(droneId, Date.now()), [droneId]);
  async function handBack(action: ManualAction) {
    setHanding(action); setError('');
    try { await manualControl(droneId, sessionId, action); }
    catch (reason) { setHanding(null); setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  const lookAt = (event: React.PointerEvent) => {
    if (paused.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    look.current = lookFromPointer((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
  };

  return <div className="pilot-overlay" role="dialog" aria-modal="true" aria-labelledby="pilot-heading">
    <div className="pilot-frame">
      <header className="pilot-heading">
        <div><span className="eyebrow">MANUAL CONTROL · SIMULATION ONLY</span><h2 id="pilot-heading">Flying {droneId}</h2></div>
        <span className={`pilot-link${linkIssue || drone.manual?.status === 'LinkLost' ? ' degraded' : ''}`} role="status">
          {drone.manual?.status === 'LinkLost' ? `Link lost · hovering · resumes in ${Math.max(0, 30 - Math.round(drone.manual.linkLostSeconds))} s`
            : linkIssue ? 'Control link degraded' : drone.manual?.status === 'Active' ? 'Control link up' : 'Connecting…'}
        </span>
      </header>
      <div className="pilot-feed" ref={feed} tabIndex={-1} onPointerMove={lookAt} data-paused={prompt}>
        <Suspense fallback={<div className="drone-cam"><p>Starting simulated feed…</p></div>}>
          <DroneCam pose={drone} live={live} nearby={fleet.filter(item => item.droneId !== droneId)} pads={pads} />
        </Suspense>
        {prompt && <div className="pilot-prompt" role="alertdialog" aria-labelledby="pilot-prompt-heading">
          <h3 id="pilot-prompt-heading">Holding position</h3>
          <p>Hand {droneId} back to its programming, or cancel the mission and return to base.</p>
          {error && <p className="form-error" role="alert">{error}</p>}
          {handing ? <p role="status">{handing === 'Resume' ? 'Resuming previous programming…' : 'Cancelling and returning to base…'}</p> : <div className="pilot-actions">
            <button className="primary" onClick={() => void handBack('Resume')}>Resume previous programming</button>
            <button className="command-danger" onClick={() => void handBack('ReturnToBase')}>Cancel and return to base</button>
            <button onClick={() => { paused.current = false; setPrompt(false); feed.current?.focus(); }}>Keep flying</button>
          </div>}
        </div>}
      </div>
      <div className="pilot-help">
        <dl>
          <div><dt><kbd>W</kbd><kbd>S</kbd></dt><dd>Forward / back</dd></div>
          <div><dt><kbd>A</kbd><kbd>D</kbd></dt><dd>Strafe</dd></div>
          <div><dt><kbd>Q</kbd><kbd>E</kbd></dt><dd>Yaw</dd></div>
          <div><dt><kbd>Space</kbd><kbd>Shift</kbd></dt><dd>Up / down</dd></div>
          <div><dt>Mouse</dt><dd>Look</dd></div>
          <div><dt><kbd>Esc</kbd></dt><dd>Exit</dd></div>
        </dl>
        <span className="pilot-readout">{readout.speed.toFixed(1)} m/s · ALT {readout.altitude.toFixed(0)} m · HDG {readout.heading.toFixed(0)}°{audio.running ? ' · audio on' : ''}</span>
      </div>
      <p className="pilot-note">Building clearance and the service area still apply. If this page loses its link the drone hovers, then resumes its programming after 30 s.</p>
    </div>
  </div>;
}
