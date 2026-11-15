import { useState } from 'react';
import { ArrowRight, Check, Coffee, Cookie } from 'lucide-react';
import CoffeeBuilder from './CoffeeBuilder';
import FoodArt from './FoodArt';
import { makeLine, menu, menuItem, money } from './demo';
import type { BagLine } from './demo';

/** Fills one payload bay with exactly one coffee or one treat. */
export default function BaySelector({ bay, current, onSave }: { bay: number; current: BagLine | null; onSave: (line: BagLine) => void }) {
  const [tab, setTab] = useState<'coffee' | 'treats'>(current && !current.coffee ? 'treats' : 'coffee');
  const coffee = current?.coffee ? current : undefined;
  const treats = menu.filter(item => item.kind !== 'coffee');
  return <div className="bay-selector">
    <div className="bay-selector-head"><div className="eyebrow">BAY 0{bay + 1} · ONE COFFEE OR ONE TREAT</div><h2 id="modal-heading">{current ? `Change bay ${bay + 1}.` : `Fill bay ${bay + 1}.`}</h2>
      <div className="bay-tabs" role="tablist" aria-label="What goes in this bay">
        <button role="tab" id="bay-tab-coffee" aria-selected={tab === 'coffee'} aria-controls="bay-panel" className={tab === 'coffee' ? 'selected' : ''} onClick={() => setTab('coffee')}><Coffee size={14} />Coffee builder</button>
        <button role="tab" id="bay-tab-treats" aria-selected={tab === 'treats'} aria-controls="bay-panel" className={tab === 'treats' ? 'selected' : ''} onClick={() => setTab('treats')}><Cookie size={14} />Treats</button>
      </div></div>
    <div id="bay-panel" role="tabpanel" aria-labelledby={`bay-tab-${tab}`}>
      {tab === 'coffee'
        ? <CoffeeBuilder item={menuItem(coffee?.itemId ?? 'flat-white')} editing={coffee} bay={bay} onSave={onSave} />
        : <div className="treat-grid">{treats.map(item => {
          const chosen = current?.itemId === item.id;
          return <button key={item.id} className={`treat-option menu-${item.kind} ${chosen ? 'chosen' : ''}`} aria-pressed={chosen} onClick={() => onSave(makeLine(item.id))}>
            <span className="food-frame"><FoodArt kind={item.kind} /></span>
            <strong>{item.name}</strong><small>{item.detail}</small>
            <span className="treat-add">{chosen ? <><Check size={13} />In bay {bay + 1}</> : <>Pack in bay {bay + 1} · {money(item.price)}<ArrowRight size={13} /></>}</span>
          </button>;
        })}</div>}
    </div>
  </div>;
}
