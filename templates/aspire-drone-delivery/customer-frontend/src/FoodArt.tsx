import { useId } from 'react';
import type { CoffeeOptions, MenuItem } from './demo';
import { defaultCoffee } from './demo';

export function CoffeeCup({ options, style = 'flat-white' }: { options: CoffeeOptions; style?: string }) {
  const id = useId().replace(/:/g, '');
  const iced = options.temperature === 'Iced';
  const black = options.milk === 'None';
  const scale = options.size === 'Small' ? .82 : options.size === 'Large' ? 1.08 : 1;
  const fill = black ? '#412719' : options.milk === 'Oat' ? '#c29c71' : options.milk === 'Almond' ? '#d4b28a' : '#cda77c';
  return <svg viewBox="0 0 360 270" className={`coffee-cup ${iced ? 'iced' : ''}`} role="img" aria-label={`${options.size} ${options.temperature.toLowerCase()} ${style.replace('-', ' ')} with ${options.milk.toLowerCase()} milk and ${options.shots} shots`}>
    <defs><linearGradient id={`cup-${id}`} x2="1" y2=".3"><stop stopColor="#fdf9ef" /><stop offset="1" stopColor="#ddd8c9" /></linearGradient>
      <clipPath id={`drink-${id}`}><path d="M125 85H235L222 215Q180 230 138 215Z" /></clipPath>
    </defs>
    <ellipse cx="180" cy="239" rx="83" ry="12" fill="#334536" opacity=".1" />
    <g transform={`translate(180 140) scale(${scale}) translate(-180 -140)`}>
      {!iced && <g className="coffee-steam" stroke="#ad9d7f" strokeWidth="2" fill="none" strokeLinecap="round"><path d="M163 62q-12-13 0-27t0-17" /><path d="M184 55q12-13 0-26" /><path d="M204 62q-12-13 0-27t0-17" /></g>}
      <path d="M125 85H235L222 215Q180 230 138 215Z" fill={iced ? '#f5f5e1' : `url(#cup-${id})`} stroke="#c6bdab" strokeWidth="1.5" />
      {iced && <g clipPath={`url(#drink-${id})`}><path d="M120 111H240V232H120Z" fill={fill} opacity=".9" /><path d="M120 164H240V232H120Z" fill={black ? '#342017' : '#ecdbbb'} opacity=".65" />
        {[0, 1, 2, 3].map(i => <rect key={i} x={137 + i * 18} y={109 + i % 2 * 22} width="23" height="23" rx="5" transform={`rotate(${i % 2 ? 18 : -16} ${148 + i * 18} 130)`} fill="#fffdf3" opacity=".64" />)}</g>}
      <path d="M132 139H229L224 191Q180 201 136 191Z" fill="#214d3d" />
      <text x="181" y="165" textAnchor="middle" fill="#fff7df" fontSize="12" fontFamily="Georgia, serif">ForthCoffee</text><text x="181" y="181" textAnchor="middle" fill="#b9c9b2" fontSize="5" letterSpacing="2">SOUTH MELBOURNE</text>
      <ellipse cx="180" cy="85" rx="57" ry="12" fill={iced ? fill : '#ede4cf'} stroke="#c6bdab" strokeWidth="1.5" />
      {!iced && <><ellipse cx="180" cy="84" rx="47" ry="8" fill={fill} />
        {!black && <path d={style === 'cappuccino' ? 'M148 84q31-13 64 0q-31 13-64 0' : 'M164 81q8-10 16 0q8-10 16 0q-2 7-16 9q-14-2-16-9'} fill="#f7eedb" />}
        {style === 'cappuccino' && <g fill="#855739">{[157, 170, 183, 197].map(x => <circle key={x} cx={x} cy={83 + x % 3} r="1" />)}</g>}</>}
      {iced && <path d="M202 107L214 42" stroke="#cfac78" strokeWidth="6" strokeLinecap="round" />}
    </g>
  </svg>;
}

export default function FoodArt({ kind }: { kind: MenuItem['kind'] }) {
  if (kind === 'coffee') return <CoffeeCup options={defaultCoffee('flat-white')} />;
  return <svg viewBox="0 0 360 270" className={`food-art ${kind}`} role="img" aria-label={`${kind} illustration`}>
    <ellipse cx="180" cy="177" rx="112" ry="49" fill="#fdf9ed" stroke="#e3daca" strokeWidth="2" />
    <ellipse cx="180" cy="179" rx="89" ry="34" fill="#eee7d7" />
    {kind === 'biscuit' && <g>
      <ellipse cx="180" cy="150" rx="69" ry="48" fill="#b77b3e" /><ellipse cx="180" cy="144" rx="70" ry="48" fill="#dbac65" />
      <ellipse cx="180" cy="139" rx="62" ry="39" fill="#e1b779" />
      {[[144, 126], [173, 113], [205, 124], [159, 150], [197, 158], [222, 146], [181, 139], [133, 146]].map(([x, y]) => <path key={x} d={`M${x} ${y}l9-2 3 8-8 3-5-4Z`} fill="#62402d" />)}
    </g>}
    {kind === 'cake' && <g>
      <path d="M122 126L216 101L249 163L150 195L122 178Z" fill="#d2a55c" /><path d="M122 126L216 101L249 143L150 176Z" fill="#f2d78c" />
      <path d="M122 126L216 101L249 119L150 151Z" fill="#f9edc9" /><path d="M150 151L249 119L245 134L235 130L229 143L214 139L206 151L187 148L177 161L162 158L151 170Z" fill="#fff6da" />
      <path d="M172 116q25-28 39-2q-15 17-39 2" fill="#e5c54f" /><path d="M180 114l22-3" stroke="#fff4b7" strokeWidth="2" />
    </g>}
    {kind === 'croissant' && <g transform="rotate(-8 180 145)">
      <path d="M102 164Q106 102 161 107L179 123L202 108Q252 109 260 168L239 179L211 150L150 151L124 179Z" fill="#bd7939" />
      <path d="M104 157Q121 104 156 112L170 149L141 166L125 174Z" fill="#e6b668" /><path d="M256 158Q239 105 205 113L191 150L219 166L237 174Z" fill="#e6b668" />
      <path d="M146 113Q178 95 215 114L204 158Q179 171 155 158Z" fill="#efc57e" />
      <path d="M164 109L168 160M185 105L187 163M205 110L202 157" stroke="#c7934f" strokeWidth="4" fill="none" />
    </g>}
    <circle cx="97" cy="191" r="3" fill="#c49b62" /><circle cx="109" cy="199" r="2" fill="#c49b62" />
  </svg>;
}
