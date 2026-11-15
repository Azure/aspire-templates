import type { MenuItem } from './demo';

export default function FoodArt({ kind }: { kind: MenuItem['kind'] }) {
  return <svg viewBox="0 0 360 220" className={`food-art ${kind}`} role="img" aria-label={`${kind} illustration`}>
    <defs>
      <radialGradient id={`plate-${kind}`}><stop stopColor="#fffef8" /><stop offset="1" stopColor="#e9e2d3" /></radialGradient>
      <filter id={`shadow-${kind}`} x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="9" floodOpacity=".17" /></filter>
    </defs>
    <ellipse cx="180" cy="127" rx="115" ry="76" fill={`url(#plate-${kind})`} filter={`url(#shadow-${kind})`} />
    <ellipse cx="180" cy="127" rx="99" ry="63" fill="none" stroke="#ded8ca" />
    <g filter={`url(#shadow-${kind})`}>
      {kind === 'burger' && <>
        <path d="M108 143 Q106 175 180 177 Q253 175 252 143" fill="#c88135" />
        <path d="M104 137 Q123 122 142 136 Q161 149 180 132 Q200 123 217 136 Q235 148 256 133 L250 150 L111 151Z" fill="#478644" />
        <rect x="110" y="126" width="140" height="20" rx="10" fill="#683d2c" />
        <path d="M108 119 L251 118 L224 142 L182 128 L140 140Z" fill="#f3bd46" />
        <path d="M108 115 C103 42 257 42 252 115Z" fill="#dfa24d" />
        <path d="M119 94 C142 58 215 54 241 96" fill="none" stroke="#edb86a" strokeWidth="13" strokeLinecap="round" />
        {[135, 160, 185, 210, 230].map((x, i) => <ellipse key={x} cx={x} cy={83 + (i % 2) * 13} rx="4" ry="1.7" fill="#fff1c8" transform={`rotate(-25 ${x} 85)`} />)}
      </>}
      {kind === 'pizza' && <>
        <ellipse cx="180" cy="119" rx="86" ry="62" fill="#c78e48" />
        <ellipse cx="180" cy="117" rx="78" ry="54" fill="#e7b76b" />
        <ellipse cx="180" cy="118" rx="70" ry="47" fill="#c8603b" />
        {[[147, 101], [199, 96], [216, 129], [164, 143], [133, 129]].map(([x, y]) => <ellipse key={x} cx={x} cy={y} rx="18" ry="13" fill="#fff2d6" />)}
        {[[156, 80], [224, 110], [186, 134], [128, 113]].map(([x, y]) => <path key={x} d={`M${x} ${y} q20 -8 19 9 q-10 12 -19 -9`} fill="#3f7c42" />)}
      </>}
      {kind === 'bowl' && <>
        <ellipse cx="180" cy="120" rx="80" ry="59" fill="#c6a37a" />
        <ellipse cx="180" cy="114" rx="73" ry="52" fill="#f2dfa9" />
        <path d="M174 63 Q259 69 249 136 L180 115Z" fill="#78a75e" />
        <path d="M107 96 Q139 54 176 64 L177 113Z" fill="#466a40" />
        <path d="M111 128 Q128 170 188 164 L178 114Z" fill="#cb784f" />
        {[0, 1, 2, 3].map(i => <path key={i} d={`M${188 + i * 10} ${119 - i * 6} q34 4 25 24 q-10 18 -25 -24`} fill="#b7c97b" stroke="#72985c" strokeWidth="3" />)}
        {[[135, 84], [152, 91], [129, 100], [150, 73], [208, 84], [224, 94], [204, 104]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="#93b95d" />)}
      </>}
      {kind === 'taco' && [0, 1].map(i => <g key={i} transform={`translate(${i * 65 - 32},${i * 12 - 4}) rotate(-15 180 120)`}>
        <path d="M134 151 Q113 63 182 68 Q228 73 222 151Z" fill="#ebc37a" />
        <path d="M141 139 Q139 87 181 86 Q212 91 214 138Z" fill="#64945a" />
        <path d="M150 123 L160 97 L194 105 L205 130Z" fill="#c89551" />
        <path d="M147 128 L199 110 M151 107 L206 129" stroke="#eee0bf" strokeWidth="6" strokeLinecap="round" />
        <path d="M145 139 Q182 155 216 137" stroke="#d7904f" strokeWidth="6" fill="none" />
      </g>)}
    </g>
    <path d="M282 164 q28 -17 32 4 q-20 19 -32 -4" fill="#74904a" />
    <circle cx="78" cy="165" r="3" fill="#9d7050" /><circle cx="86" cy="172" r="2" fill="#9d7050" />
  </svg>;
}
