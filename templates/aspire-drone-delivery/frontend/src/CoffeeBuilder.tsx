import { useState } from 'react';
import { ArrowRight, Check, Coffee } from 'lucide-react';
import { CoffeeCup } from './FoodArt';
import { coffeeDescription, coffeeSizes, defaultCoffee, linePrice, makeLine, menu, milkOptions, money, temperatures } from './demo';
import type { BagLine, CoffeeOptions, MenuItem } from './demo';

function Choices<T extends string | number>({ title, options, value, onChange, label = String }: {
  title: string; options: readonly T[]; value: T; onChange: (value: T) => void; label?: (value: T) => string;
}) {
  return <fieldset className="builder-group"><legend>{title}</legend><div className="builder-choices">
    {options.map(option => <button key={option} type="button" className={value === option ? 'chosen' : ''} aria-pressed={value === option} onClick={() => onChange(option)}>{label(option)}{value === option && <Check size={12} />}</button>)}
  </div></fieldset>;
}

export default function CoffeeBuilder({ item: initialItem, editing, bay, onSave }: {
  item: MenuItem; editing?: BagLine; bay: number; onSave: (line: BagLine) => void;
}) {
  const [item, setItem] = useState(initialItem);
  const [options, setOptions] = useState<CoffeeOptions>(editing?.coffee ?? defaultCoffee(initialItem.id));
  const line = makeLine(item.id, options);
  function chooseStyle(id: string) {
    const next = menu.find(entry => entry.id === id);
    if (!next) return;
    setItem(next);
    setOptions(current => ({ ...current, milk: defaultCoffee(id).milk }));
  }
  return <div className="coffee-builder">
    <div className="builder-preview">
      <span className="eyebrow">YOUR CUP. YOUR CALL.</span>
      <CoffeeCup options={options} style={item.id} />
      <div className="cup-caption" aria-live="polite"><span>{options.temperature === 'Iced' ? 'CHILLED TO PERFECTION' : 'FRESHLY BREWED, THEN FLOWN'}</span><h3>{item.name}</h3><p>{coffeeDescription(options)}</p></div>
      <span className="builder-pack-note"><Coffee size={14} />Every size fills one insulated bay.</span>
    </div>
    <div className="builder-controls">
      <h3 className="builder-title">{editing ? 'Fine-tune your cup.' : 'Make it your kind of coffee.'}</h3>
      <Choices title="01 / Style" options={menu.filter(entry => entry.kind === 'coffee').map(entry => entry.id)} value={item.id} onChange={chooseStyle} label={id => menu.find(entry => entry.id === id)!.name} />
      <Choices title="02 / Size" options={coffeeSizes} value={options.size} onChange={size => setOptions({ ...options, size })} label={size => `${size}${size === 'Regular' ? ' +50c' : size === 'Large' ? ' +$1' : ''}`} />
      <Choices title="03 / Milk" options={milkOptions} value={options.milk} onChange={milk => setOptions({ ...options, milk })} label={milk => `${milk}${['Oat', 'Almond', 'Soy'].includes(milk) ? ' +80c' : ''}`} />
      <div className="builder-split">
        <Choices title="04 / Espresso shots" options={[1, 2, 3] as const} value={options.shots} onChange={shots => setOptions({ ...options, shots })} label={shots => `${shots}${shots === 3 ? ' +70c' : ''}`} />
        <Choices title="05 / Sugar" options={[0, 1, 2] as const} value={options.sugar} onChange={sugar => setOptions({ ...options, sugar })} label={sugar => sugar === 0 ? 'None' : String(sugar)} />
      </div>
      <Choices title="06 / Temperature" options={temperatures} value={options.temperature} onChange={temperature => setOptions({ ...options, temperature })} />
      <p className="builder-allergens">Plant milk is a preference, not an allergen-free guarantee. This fictional menu is not dietary advice.</p>
      <div className="builder-checkout">
        <button className="primary-button" onClick={() => onSave(line)}>{editing ? 'Save changes' : `Pack in bay ${bay + 1}`} · {money(linePrice(line))}<ArrowRight size={16} /></button></div>
    </div>
  </div>;
}
