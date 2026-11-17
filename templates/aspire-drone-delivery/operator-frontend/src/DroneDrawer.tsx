import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { CamPad } from '../../frontend-shared/DroneCam';
import { X } from 'lucide-react';
import { commandDrone } from './api';
import type { DroneCommand, Telemetry } from './api';
import { commandUnavailable, droneLabel } from './model';

const DroneCam = lazy(() => import('../../frontend-shared/DroneCam'));
const commands: { command: DroneCommand; title: string; detail: string }[] = [
  { command: 'EmergencyLanding', title: 'Emergency landing', detail: 'Descend here and ground the drone until reactivated.' },
  { command: 'ReturnToBase', title: 'Return to base', detail: 'Interrupt this mission, return home and unload there.' },
  { command: 'DiscardPackage', title: 'Discard package', detail: 'Fly to the waste drop-off, release the package, then return home.' },
  { command: 'Reactivate', title: 'Reactivate', detail: 'Recover a grounded drone: return to base and rejoin dispatch.' },
];

export default function DroneDrawer({ drone, fleet, pads = [], onSelect, onClose }: {
  drone: Telemetry; fleet: Telemetry[]; pads?: CamPad[]; onSelect: (id: string) => void; onClose: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab') return;
      const elements = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select');
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keys);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keys); previous?.focus(); };
  }, []);
  const awaiting = pending !== null && drone.control?.commandId !== pending;
  async function send(command: DroneCommand) {
    if (sending || awaiting || commandUnavailable(drone, command)) return;
    setSending(true); setError('');
    try { setPending((await commandDrone(drone.droneId, command)).commandId); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSending(false); }
  }
  return <div className="drawer-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="drone-drawer" role="dialog" aria-modal="true" aria-labelledby="drone-heading" ref={panel}>
      <header className="drawer-heading"><div><span className="eyebrow">FLEET CONTROL / SIMULATION ONLY</span><h2 id="drone-heading">{drone.droneId}</h2></div><button className="icon-button" aria-label="Close drone panel" onClick={onClose}><X size={20} /></button></header>
      <label className="drone-select">Inspect drone<select value={drone.droneId} onChange={event => onSelect(event.target.value)}>{fleet.map(item => <option key={item.droneId}>{item.droneId}</option>)}</select></label>
      <Suspense fallback={<div className="drone-cam"><p>Starting simulated feed…</p></div>}>
        <DroneCam pose={drone} nearby={fleet.filter(item => item.droneId !== drone.droneId)} pads={pads} />
      </Suspense>
      <div className="drawer-body">
        <div className="drone-facts"><strong>{droneLabel(drone)}</strong><span>{drone.class} · {drone.batteryPercent.toFixed(0)}% battery</span><span>{drone.carryingPackage ? 'Package on board' : 'No package on board'} · {drone.queuedMissions} queued</span><small>{drone.orderId ?? 'No active order'}</small></div>
        {drone.routingError && <p className="form-error" role="alert">Flight blocked: {drone.routingError}</p>}
        <p className="command-disclaimer">Interrupting a mission marks that delivery unable to complete. Queued orders are reassigned. Commands run one at a time.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        {awaiting ? <p className="command-status" role="status">Command accepted. Waiting for the simulator…</p>
          : drone.control && <p className="command-status" role={drone.control.status === 'Rejected' ? 'alert' : 'status'}><strong>{drone.control.status === 'Executing' ? 'Command in progress' : `Last command · ${drone.control.status}`}</strong><br />{drone.control.message}</p>}
        <div className="drone-commands">{commands.map(({ command, title, detail }) => {
          const reason = commandUnavailable(drone, command);
          return <div key={command}><button className={command === 'EmergencyLanding' ? 'command-danger' : ''} disabled={sending || awaiting || !!reason} title={reason || detail} onClick={() => void send(command)}>{title}</button><small>{reason || detail}</small></div>;
        })}</div>
      </div>
    </aside>
  </div>;
}
