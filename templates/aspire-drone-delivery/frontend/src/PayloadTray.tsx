import { Coffee, Plus, X } from 'lucide-react';
import { CoffeeCup } from './FoodArt';
import FoodArt from './FoodArt';
import { bagUnits, menuItem, payloadNames, payloadSizes, spaceLabel } from './demo';
import type { Bag, BagLine, PayloadSize } from './demo';

export function PayloadPicker({ value, used, onChange }: { value: PayloadSize | null; used: number; onChange: (size: PayloadSize) => void }) {
  return <div className="payload-options" role="group" aria-label="Payload size">{payloadSizes.map(size =>
    <button key={size} className={value === size ? 'selected' : ''} aria-pressed={value === size} disabled={used > size * 4} onClick={() => onChange(size)}>
      <span className="payload-mini">{Array.from({ length: size }, (_, i) => <i key={i} />)}</span>
      <strong>{payloadNames[size]}</strong><small>{size === 1 ? 'A moment for you' : size === 2 ? 'Coffee for two' : 'The whole crew'}</small><span>{size} cup well{size === 1 ? '' : 's'}</span>
    </button>)}</div>;
}

export default function PayloadTray({ bag, payload, onAdd, onEdit, onRemove }: {
  bag: Bag; payload: PayloadSize | null; onAdd: () => void; onEdit: (line: BagLine) => void; onRemove: (id: string) => void;
}) {
  const used = bagUnits(bag), capacity = (payload ?? 2) * 4;
  const coffees = bag.filter(line => line.coffee).flatMap(line => Array.from({ length: line.quantity }, (_, index) => ({ line, index })));
  const treats = bag.filter(line => !line.coffee).flatMap(line => Array.from({ length: line.quantity }, (_, index) => ({ line, index })))
    .sort((a, b) => menuItem(b.line.itemId).units - menuItem(a.line.itemId).units);
  const cells: { coffee?: BagLine; treats?: BagLine[] }[] = Array.from({ length: payload ?? 2 }, () => ({}));
  coffees.forEach(({ line }, index) => { if (cells[index]) cells[index].coffee = line; });
  let well = coffees.length, filled = 0;
  treats.forEach(({ line }) => {
    const units = menuItem(line.itemId).units;
    if (filled + units > 4) { well++; filled = 0; }
    if (cells[well]) cells[well].treats = [...(cells[well].treats ?? []), line];
    filled += units;
  });
  return <div className={`payload-tray ${payload ? '' : 'unselected'}`}>
    <div className="tray-topline"><span><span className="live-dot" />{payload ? `${payloadNames[payload]} flight box` : 'YOUR FLIGHT BOX'}</span><span>FC / STH MELB</span></div>
    <div className={`tray-wells wells-${payload ?? 2}`}>
      {cells.map((cell, index) => <div className={`tray-well ${cell.coffee || cell.treats ? 'occupied' : ''}`} key={index}>
        {cell.coffee ? <><button className="well-content" onClick={() => onEdit(cell.coffee!)} aria-label={`Edit ${menuItem(cell.coffee.itemId).name} in well ${index + 1}`}><CoffeeCup options={cell.coffee.coffee!} style={cell.coffee.itemId} /><span>{menuItem(cell.coffee.itemId).name}</span></button><button className="well-remove" onClick={() => onRemove(cell.coffee!.id)} aria-label={`Remove one ${menuItem(cell.coffee.itemId).name}`}><X size={12} /></button></>
          : cell.treats ? <div className="well-treats">{cell.treats.map((line, i) => <button key={i} style={{ gridColumn: menuItem(line.itemId).units === 2 ? 'span 2' : undefined }} onClick={() => onRemove(line.id)} aria-label={`Remove one ${menuItem(line.itemId).name}`}><FoodArt kind={menuItem(line.itemId).kind} /><span>{menuItem(line.itemId).name}<X size={10} /></span></button>)}</div>
            : <button className="well-empty" onClick={onAdd}><Plus size={24} strokeWidth={1} /><span>{payload ? 'Build a coffee' : 'Choose your payload'}</span><small>or save room for a treat</small></button>}
        <span className="well-number">0{index + 1}</span>
      </div>)}
    </div>
    <div className="tray-bottomline"><Coffee size={14} /><span>{payload ? `${spaceLabel(capacity - used)} free` : 'Coffees, companions, good mornings.'}</span><strong>{payload ? `${Math.round(used / capacity * 100)}% packed` : 'PACKED FOR THE SKY'}</strong></div>
    <div className="capacity-track" role="progressbar" aria-label="Payload capacity used" aria-valuemin={0} aria-valuemax={capacity} aria-valuenow={used}><i style={{ width: `${used / capacity * 100}%` }} /></div>
  </div>;
}
