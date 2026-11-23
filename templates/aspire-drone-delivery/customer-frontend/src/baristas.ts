// Fictional baristas for the demo. Profiles are mock content, not real staff.
export type Barista = {
  id: string; name: string; avatar: string; since: number; backstory: string;
  aflTeam: string; favouriteCoffee: string; facts: { label: string; value: string }[];
};

const barista = (id: string, name: string, since: number, backstory: string, aflTeam: string, favouriteCoffee: string, facts: [string, string][]): Barista =>
  ({ id, name, avatar: `/baristas/${id}.png`, since, backstory, aflTeam, favouriteCoffee, facts: facts.map(([label, value]) => ({ label, value })) });

export const baristas: Barista[] = [
  barista('maeve', 'Maeve', 2021, 'Swapped a uni arts degree for latte art after one too many 7am tutorials. Still sketches regulars on the back of dockets.', 'Collingwood', 'Magic, extra hot', [['Off shift', 'Life drawing in Fitzroy'], ['Milk jug', 'Tulips, never hearts']]),
  barista('sal', 'Sal', 2009, 'Has pulled shots on Coventry Street longer than the drones have flown. Calibrates the grinder by ear every morning.', 'Carlton', 'Short black, no sugar', [['Off shift', 'Restoring a 1970s lever machine'], ['Swears by', 'A clean group head']]),
  barista('priya', 'Priya', 2019, 'A former lab chemist who now runs the roast tastings. Keeps a notebook of every bean that has crossed the bar.', 'Western Bulldogs', 'Batch brew, Ethiopian', [['Off shift', 'Merri Creek trail runs'], ['Ask her about', 'Water hardness']]),
  barista('kenji', 'Kenji', 2022, 'Moved down from Brisbane for the coffee and stayed for the laneways. Times every pour-over to the second.', 'Brisbane Lions', 'V60, light roast', [['Off shift', 'Vinyl hunting on Smith Street'], ['Pet peeve', 'Lids on dine-in cups']]),
  barista('amara', 'Amara', 2020, 'Started as the Saturday dishie and now trains every new starter. Knows half of South Melbourne by their order.', 'Richmond', 'Iced long black', [['Off shift', 'Netball, wing defence'], ['Motto', 'Weigh the dose']]),
  barista('luca', 'Luca', 2018, 'Got hooked on coffee pulling weekend shifts at a Brunswick bakery. Makes the best babyccino in the city, apparently.', 'Essendon', 'Macchiato', [['Off shift', 'Tattoo sketchbook'], ['Signature', 'Rosettas in threes']]),
  barista('tevita', 'Tevita', 2023, 'A former primary school teacher who still explains milk texture like a science lesson. Learned to steam milk at a Footscray café.', 'Hawthorn', 'Flat white, full cream', [['Off shift', 'Park run, most Saturdays'], ['Known for', 'Remembering every name']]),
  barista('margot', 'Margot', 2012, 'Ran a bookshop on Clarendon Street before joining the bar. Leaves a dog-eared paperback on the windowsill for anyone to borrow.', 'St Kilda', 'Piccolo latte', [['Off shift', 'Crosswords, in pen'], ['Currently reading', 'Something with a map in it']]),
  barista('jedda', 'Jedda', 2021, 'Studied graphic design and drew the ForthCoffee cup sleeves. Grew up on the Mornington Peninsula and still drives down to surf.', 'Geelong', 'Oat latte', [['Off shift', 'Surfing at Gunnamatta'], ['Desk', 'Always a fresh sketch']]),
  barista('omar', 'Omar', 2016, 'An engineer at heart who keeps the espresso machine and the drone launch pad in tune. Will happily explain pressure profiling.', 'Melbourne', 'Cortado', [['Off shift', 'Building model aircraft'], ['Fix-it record', 'Three grinders this year']]),
  barista('finn', 'Finn', 2024, 'The newest face on the bar and the first to volunteer for the 6am open. Practising his latte art one wobbly swan at a time.', 'North Melbourne', 'Mocha, extra chocolate', [['Off shift', 'Indie gigs at the Corner'], ['Goal', 'A swan that looks like a swan']]),
  barista('valentina', 'Valentina', 2017, 'Started on the bar during her accounting degree and became head barista instead. Curates the single-origin rotation.', 'Sydney Swans', 'Cold brew tonic', [['Off shift', 'Bouldering in Collingwood'], ['Hot tip', 'Try the decaf, honestly']]),
];

// Stable across reloads: the same order always gets the same barista.
export function baristaFor(orderId: string): Barista {
  let hash = 0;
  for (const character of orderId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return baristas[hash % baristas.length];
}
