import { Coffee, Plus, X } from 'lucide-react';
import { CoffeeCup } from './FoodArt';
import FoodArt from './FoodArt';
import { menuItem, payloadNames, payloadSizes } from './demo';
import type { Bays, PayloadSize } from './demo';

export function PayloadPicker({ value, filled, onChange }: { value: PayloadSize | null; filled: number; onChange: (size: PayloadSize) => void }) {
  return <div className="payload-options" role="group" aria-label="Payload size">{payloadSizes.map(size =>
    <button key={size} className={value === size ? 'selected' : ''} aria-pressed={value === size} disabled={filled > size} onClick={() => onChange(size)}>
      <span className="payload-mini">{Array.from({ length: size }, (_, i) => <i key={i} />)}</span>
      <strong>{payloadNames[size]}</strong><small>{size === 1 ? 'A moment for you' : size === 2 ? 'Coffee for two' : 'The whole crew'}</small><span>{size} bay{size === 1 ? '' : 's'}</span>
    </button>)}</div>;
}

export default function PayloadTray({ bays, payload, onSelect, onClear }: {
  bays: Bays; payload: PayloadSize | null; onSelect: (bay: number) => void; onClear: (bay: number) => void;
}) {
  const cells = payload ? bays : Array.from({ length: 2 }, () => null);
  const filled = bays.filter(Boolean).length, size = payload ?? 2;
  return <div className={`payload-tray ${payload ? '' : 'unselected'}`}>
    <div className="tray-topline"><span><span className="live-dot" />{payload ? `${payloadNames[payload]} flight box` : 'YOUR FLIGHT BOX'}</span><span>FC / STH MELB</span></div>
    <div className={`tray-wells wells-${size}`}>
      {cells.map((line, index) => {
        const item = line && menuItem(line.itemId);
        return <div className={`tray-well ${line ? 'occupied' : ''}`} key={index}>
          {line && item ? <><button className="well-content" onClick={() => onSelect(index)} aria-label={`Change ${item.name} in bay ${index + 1}`}>
            {line.coffee ? <CoffeeCup options={line.coffee} style={line.itemId} /> : <FoodArt kind={item.kind} />}<span>{item.name}</span></button>
            <button className="well-remove" onClick={() => onClear(index)} aria-label={`Empty bay ${index + 1}`}><X size={12} /></button></>
            : <button className="well-empty" onClick={() => onSelect(index)} aria-label={payload ? `Fill bay ${index + 1}` : 'Choose your payload'}><Plus size={24} strokeWidth={1} /><span>{payload ? 'Add a coffee or treat' : 'Choose your payload'}</span><small>{payload ? 'One per bay' : 'Single, double or quad'}</small></button>}
          <span className="well-number">0{index + 1}</span>
        </div>;
      })}
    </div>
    <div className="tray-bottomline"><Coffee size={14} /><span>{payload ? `${size - filled} of ${size} bay${size === 1 ? '' : 's'} free` : 'Coffees, companions, good mornings.'}</span><strong>{payload ? `${Math.round(filled / size * 100)}% packed` : 'PACKED FOR THE SKY'}</strong></div>
    <div className="capacity-track" role="progressbar" aria-label="Payload bays filled" aria-valuemin={0} aria-valuemax={size} aria-valuenow={filled}><i style={{ width: `${filled / size * 100}%` }} /></div>
  </div>;
}
