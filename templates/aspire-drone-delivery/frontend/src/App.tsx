import { useEffect, useReducer, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, Check, ChevronDown, Clock3, Coffee, Drone, Headphones, Leaf, MapPin, Mic, Minus, Navigation, Pause, Play, Plus, RotateCcw, Search, Settings2, ShieldCheck, ShoppingBag, Sparkles, Store, UtensilsCrossed, X } from 'lucide-react';
import DeliveryMap from './DeliveryMap';
import type { MapSettings } from './DeliveryMap';
import FoodArt from './FoodArt';
import { bagTotal, demoFlights, demoReducer, initialState, matchSpokenOrder, menu, money } from './demo';
import type { Bag, MenuItem } from './demo';

type Modal = 'voice' | 'bag' | 'maps' | 'about' | null;
const categories = ['All good things', 'Burgers', 'Pizza', 'Fresh & green', 'By the sea'];

export default function App() {
  const [portal, setPortal] = useState<'customer' | 'vendor'>('customer');
  const [state, dispatch] = useReducer(demoReducer, initialState);
  const [paused, setPaused] = useState(false);
  const [bag, setBag] = useState<Bag>({});
  const [modal, setModal] = useState<Modal>(null);
  const [category, setCategory] = useState(0);
  const [query, setQuery] = useState('');
  const [transcript, setTranscript] = useState('Two burgers and one bowl, please');
  const [voiceProposal, setVoiceProposal] = useState<Bag | null>(null);
  const [voiceError, setVoiceError] = useState('');
  const [maps, setMaps] = useState<MapSettings | null>(null);
  const [mapClientId, setMapClientId] = useState('');
  const [mapToken, setMapToken] = useState('');
  const [mapError, setMapError] = useState('');
  const [notice, setNotice] = useState('');
  const [tracking, setTracking] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const count = Object.values(bag).reduce((sum, quantity) => sum + quantity, 0);
  const myOrder = state.orders.find(order => order.customer === 'You');
  const visibleItems = menu.filter((item, index) => (category === 0 || category === index + 1) && `${item.name} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));
  const activeOrders = state.orders.filter(order => order.stage !== 'Delivered');
  const fleet = [...demoFlights(state.ticks), { id: 'SKY-05', status: 'Charging' }, { id: 'SKY-06', status: 'Charging' }];

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => dispatch({ type: 'tick' }), 1000);
    return () => window.clearInterval(timer);
  }, [paused]);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!modal) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModal(null);
      if (event.key === 'Tab') {
        const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, a[href]');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', handler); opener.current?.focus(); };
  }, [modal]);

  function changeQuantity(item: MenuItem, change: number) {
    setBag(current => {
      const next = { ...current };
      next[item.id] = Math.max(0, Math.min(9, (next[item.id] || 0) + change));
      if (!next[item.id]) delete next[item.id];
      return next;
    });
  }
  function confirm() {
    dispatch({ type: 'confirm', bag });
    setBag({});
    setModal(null);
    setTracking(true);
    setNotice('Order confirmed. Your kitchen is getting to work.');
  }
  function openVoice() {
    setVoiceError(''); setVoiceProposal(null); setModal('voice');
  }
  function interpret() {
    const result = matchSpokenOrder(transcript);
    setVoiceProposal(result.error ? null : result.bag);
    setVoiceError(result.error || '');
  }

  return <div className="app-shell">
    <div className="demo-strip"><span>AN ASPIRE SHOWCASE</span><span className="strip-message">Good food. A fresh perspective.</span><button onClick={() => setModal('about')}>Design preview <ArrowRight size={12} /></button></div>
    <header className="site-header">
      <a href="#" className="wordmark" aria-label="Skylane home" onClick={event => { event.preventDefault(); setPortal('customer'); setTracking(false); }}><span className="brand-symbol"><Drone size={25} strokeWidth={1.6} /></span>skylane<span className="brand-period">.</span></a>
      <div className="portal-switch" aria-label="Choose demo experience"><button className={portal === 'customer' ? 'selected' : ''} aria-pressed={portal === 'customer'} onClick={() => setPortal('customer')}><UtensilsCrossed size={14} />Order something</button><button className={portal === 'vendor' ? 'selected' : ''} aria-pressed={portal === 'vendor'} onClick={() => setPortal('vendor')}><Store size={14} />Kitchen & fleet</button></div>
      <div className="header-actions"><span className="location"><MapPin size={15} /> Mornington, VIC <ChevronDown size={12} /></span><button className="bag-button" onClick={() => setModal('bag')} aria-label={`Open bag, ${count} items`}><ShoppingBag size={17} /><span className="bag-word">Your bag</span><span className="bag-count">{count}</span></button></div>
    </header>

    {portal === 'customer' ? <main>
      <section className="customer-hero">
        <div className="hero-copy"><div className="eyebrow"><span className="small-line" /> A NEW WAY TO DO LOCAL</div><h1>Your favourites.<br />A little <em>closer.</em></h1><p>Made around the corner. Delivered above it.<br />Discover Mornington’s good food, with a little lift.</p>
          <div className="hero-buttons"><button className="primary-button" onClick={() => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' })}>Find your next favourite <ArrowDown size={16} /></button><button className="text-button" onClick={openVoice}><Mic size={17} />Or, just say it <span className="new-badge">TRY IT</span></button></div>
          <div className="hero-footnote"><span><Leaf size={14} /> Locally made</span><span><Drone size={15} /> A lighter last mile</span><span><Clock3 size={14} /> No traffic, just takeaway</span></div>
        </div>
        <div className="hero-visual">
          <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" /><div className="visual-topline"><span className="live-dot" />THE MORNINGTON EDIT <span>38.22° S / 145.04° E</span></div>
          <svg className="hero-drone" viewBox="0 0 480 300" role="img" aria-label="Illustrated delivery drone carrying a takeaway bag">
            <defs><filter id="drone-shadow"><feDropShadow dx="0" dy="14" stdDeviation="12" floodOpacity=".12" /></filter><linearGradient id="drone-body" x2="0" y2="1"><stop stopColor="#fffef6" /><stop offset="1" stopColor="#d2d7c8" /></linearGradient></defs>
            <ellipse cx="250" cy="268" rx="102" ry="9" fill="#163e2d" opacity=".07" />
            <g filter="url(#drone-shadow)" transform="rotate(-9 240 120)">
              <path d="M170 100L110 70M300 100L362 65M170 130L110 164M300 130L360 161" stroke="#e9eadd" strokeWidth="17" strokeLinecap="round" />
              {[[106, 67], [366, 63], [106, 167], [365, 165]].map(([x, y]) => <g key={`${x}-${y}`}><ellipse cx={x} cy={y} rx="49" ry="12" fill="none" stroke="#74927e" strokeWidth="2" opacity=".4" /><ellipse cx={x} cy={y} rx="40" ry="5" fill="#eef0df" opacity=".8" /><rect x={x - 6} y={y - 6} width="12" height="16" rx="4" fill="#204b37" /></g>)}
              <path d="M169 89Q233 68 300 88L309 133Q240 158 163 131Z" fill="url(#drone-body)" /><path d="M207 92L267 89L276 119L202 124Z" fill="#1a4c38" /><circle cx="241" cy="107" r="5" fill="#a9c49b" />
              <path d="M187 139L195 165M286 140L277 165" stroke="#254b38" strokeWidth="4" />
              <path d="M206 154L199 196M274 154L280 196" stroke="#d2c299" strokeWidth="2" />
              <path d="M196 184L282 184L293 246L188 246Z" fill="#cba974" /><path d="M196 184L207 174H273L282 184" fill="#dcc397" /><path d="M228 184V246H253V184" fill="#e1cf9f" /><path d="M229 208Q240 196 252 208" stroke="#527553" strokeWidth="2" fill="none" />
            </g>
          </svg>
          <div className="floating-delivery"><span className="floating-icon"><Navigation size={17} /></span><div><strong>A good thing is on its way.</strong><small>From Main Street, with love.</small></div><span className="floating-dot" /></div>
          <div className="visual-bottomline"><span>LESS ROAD. MORE NEIGHBOURHOOD.</span><span>01 — MORNINGTON</span></div>
        </div>
      </section>

      <div className="community-strip"><span>SMALL TOWN. GOOD TASTE.</span><p>A few local favourites. One sky-high way to get them.</p><span className="community-right"><ShieldCheck size={16} /> Fictional kitchens. Real good possibilities.</span></div>

      {myOrder && tracking && <section className="tracking-panel" aria-live="polite"><div><span className="eyebrow">YOUR LITTLE DELIVERY · {myOrder.id}</span><h2>{myOrder.stage === 'Delivered' ? 'A good thing has arrived.' : myOrder.stage === 'Delivering' ? 'Look up. Lunch is on its way.' : 'Good things are in the making.'}</h2><p>{myOrder.stage} · {Object.values(myOrder.bag).reduce((sum, value) => sum + value, 0)} items · {money(bagTotal(myOrder.bag))}</p><div className="tracking-steps">{['Preparing', 'Ready for pickup', 'Delivering', 'Delivered'].map(stage => <span key={stage} className={myOrder.stage === stage ? 'current' : ''}>{stage}</span>)}</div></div><button className="icon-button" aria-label="Hide delivery tracking" onClick={() => setTracking(false)}><X size={18} /></button></section>}

      <section className="menu-section" id="menu"><div className="section-heading"><div><div className="eyebrow">THE NEIGHBOURHOOD MENU</div><h2>Local legends. <em>Lifted.</em></h2><p>Fresh from Peninsula Kitchen, our fictional neighbourhood collective.</p></div><label className="search-field"><Search size={16} /><input placeholder="What are you craving?" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search menu" /></label></div>
        <div className="category-row">{categories.map((name, index) => <button key={name} onClick={() => setCategory(index)} aria-pressed={category === index} className={category === index ? 'active' : ''}>{index === 0 && <Sparkles size={14} />}{name}</button>)}<span className="delivery-estimate"><Clock3 size={14} />Simulated deliveries · $0 delivery</span></div>
        <div className="menu-grid">{visibleItems.map(item => <article className="menu-card" key={item.id}><div className="food-frame"><FoodArt kind={item.kind} /><span className="food-label">{item.tag}</span></div><div className="menu-card-body"><div className="restaurant-name"><span className="restaurant-dot" /> PENINSULA KITCHEN <span>4.9 ★</span></div><h3>{item.name}</h3><p>{item.detail}</p><div className="food-bottom"><strong>{money(item.price)}</strong><button className={`add-button ${bag[item.id] ? 'added' : ''}`} onClick={() => { changeQuantity(item, 1); setNotice(`${item.name} added to your bag.`); }} disabled={(bag[item.id] || 0) >= 9} aria-label={`Add ${item.name} to bag`}>{bag[item.id] ? <>{bag[item.id]} <Plus size={15} /></> : <Plus size={18} />}</button></div></div></article>)}</div>
        {visibleItems.length === 0 && <p className="empty-state">Nothing on this menu matches yet. Try another craving.</p>}
      </section>
      <section className="voice-banner"><span className="voice-banner-icon"><Mic size={25} /></span><div><span className="eyebrow">LESS TAPPING. MORE TASTING.</span><h2>“Two burgers and a bowl, please.”</h2><p>Say what sounds good. Check your bag. Make it yours.</p></div><button className="primary-button" onClick={openVoice}>Explore voice ordering <ArrowRight size={16} /></button><span className="preview-label">SCRIPTED UX PREVIEW</span></section>
      <section className="customer-map-section"><div className="section-heading"><div><div className="eyebrow">OUR LITTLE PATCH OF SKY</div><h2>Made here. <em>Flown here.</em></h2><p>A new perspective on the neighbourhood we know and love.</p></div><button className="text-button" onClick={() => setPortal('vendor')}>Meet the fleet <ArrowRight size={15} /></button></div><DeliveryMap tick={state.ticks} orders={state.orders} settings={maps} onSettings={() => setModal('maps')} compact /></section>
    </main> : <main className="vendor-main">
      <div className="vendor-heading"><div><div className="eyebrow">PENINSULA KITCHEN / OPERATIONS</div><h1>Your neighbourhood,<br /><em>in motion.</em></h1><p>A little coordination. A lot of good food.</p></div><div className="vendor-controls"><span className="live-pill"><span className="live-dot" />{paused ? 'Simulation paused' : 'Simulation live'}</span><button className="outline-button" onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Resume' : 'Pause'}</button><button className="icon-button" onClick={() => { dispatch({ type: 'reset' }); setTracking(false); setNotice('Simulation reset to the opening scene.'); }} aria-label="Reset demo simulation"><RotateCcw size={16} /></button></div></div>
      <div className="stat-grid"><div><span>ACTIVE ORDERS <ShoppingBag size={15} /></span><strong>{activeOrders.length.toString().padStart(2, '0')}</strong><small>Good things in the making</small></div><div><span>IN THE AIR <Drone size={16} /></span><strong>{fleet.filter(drone => drone.status !== 'Charging').length.toString().padStart(2, '0')}<em>/ 06</em></strong><small>{fleet.filter(drone => drone.status === 'Charging').length} drones charging at base</small></div><div><span>RECENTLY DELIVERED <Check size={16} /></span><strong>{state.orders.filter(order => order.stage === 'Delivered').length.toString().padStart(2, '0')}</strong><small>Recent completed demo deliveries</small></div><div><span>A LIGHTER LAST MILE <Leaf size={16} /></span><strong>100<em>% demo</em></strong><small>No real flights. No actual emissions claim.</small></div></div>
      <div className="operations-grid"><section className="operations-map"><div className="panel-heading"><h2>The neighbourhood, live<span className="live-dot" /></h2><button className="icon-button" aria-label="Map settings" onClick={() => setModal('maps')}><Settings2 size={17} /></button></div><DeliveryMap tick={state.ticks} orders={state.orders} settings={maps} onSettings={() => setModal('maps')} /><div className="map-legend"><span><i className="legend-store" />Kitchen</span><span><i className="legend-flight" />Simulated drone</span><span><i className="legend-route" />Demo route</span><span>Main Street · Mornington</span></div></section>
        <aside className="dispatch-panel"><div className="panel-heading"><h2>The pass <span className="count-badge">{activeOrders.length}</span></h2><span className="eyebrow">LIVE QUEUE</span></div><p className="queue-intro">From our kitchen to their doorstep.</p><div className="order-list">{activeOrders.map(order => <article className="queue-order" key={order.id}><div className="queue-order-top"><strong>{order.id}</strong><span className={`status-tag ${order.stage === 'Ready for pickup' ? 'ready' : order.stage === 'Delivering' ? 'flying' : ''}`}>{order.stage}</span></div><h3>{order.customer} <span>· Mornington</span></h3><p>{Object.entries(order.bag).map(([id, quantity]) => `${quantity}× ${menu.find(item => item.id === id)?.name}`).join(', ')}</p><div className="queue-order-bottom"><span><Clock3 size={12} />{order.stage === 'Preparing' ? 'Kitchen is on it' : order.stage === 'Ready for pickup' ? 'Auto-pickup in a moment' : 'A little closer each second'}</span>{order.stage === 'Ready for pickup' && <button onClick={() => { dispatch({ type: 'pickup', id: order.id }); setNotice(`${order.id}: pickup requested. Demo delivery is underway.`); }}>Request pickup <ArrowRight size={12} /></button>}</div></article>)}</div><div className="queue-note"><Coffee size={17} /><p>Synthetic orders arrive every 45 seconds. Ready orders wait 30 seconds for you, then dispatch automatically.</p></div></aside></div>
      <div className="fleet-strip"><span className="eyebrow">ON THE ROSTER</span>{fleet.map((drone, index) => <div key={drone.id}><span className={`fleet-drone ${drone.status === 'Charging' ? 'charging' : ''}`}><Drone size={19} /></span><span><strong>{drone.id}</strong><small>{drone.status}</small></span><span className="battery">{drone.status === 'Charging' ? '↗ ' : ''}{[86, 74, 62, 91, 48, 73][index]}%</span></div>)}</div>
    </main>}

    <footer><a className="footer-brand" href="#" onClick={event => { event.preventDefault(); setModal('about'); }}>skylane.</a><span>Made for the neighbourhood. Built with Aspire.</span><button onClick={() => setModal('about')}>A fictional world, by design <ArrowRight size={13} /></button><span className="footer-coordinates">MORNINGTON · 38.22° S, 145.04° E</span></footer>
    {notice && <div role="status" className="toast"><Check size={17} />{notice}</div>}
    {modal && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className={`modal ${modal === 'bag' ? 'bag-modal' : ''}`} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="modal-heading"><button className="modal-close icon-button" onClick={() => setModal(null)} aria-label="Close dialog"><X size={20} /></button>
      {modal === 'voice' && <><span className="dialog-symbol"><Mic size={28} /></span><div className="eyebrow">A LITTLE LESS TAPPING</div><h2 id="modal-heading">What sounds good?</h2><p>This is a scripted voice-ordering preview. No microphone is accessed, no audio is recorded, and no AI service is called.</p><label className="field-label" htmlFor="transcript">Your editable example transcript</label><textarea id="transcript" value={transcript} onChange={event => { setTranscript(event.target.value); setVoiceProposal(null); setVoiceError(''); }} /><button className="primary-button full-width" onClick={interpret}><Sparkles size={16} />Match to the menu</button>{voiceError && <p className="form-error" role="alert">{voiceError}</p>}{voiceProposal && <div className="voice-proposal"><div className="eyebrow"><Check size={14} /> HERE’S WHAT WE HEARD</div>{Object.entries(voiceProposal).map(([id, quantity]) => <div key={id}><span>{quantity} × {menu.find(item => item.id === id)?.name}</span><strong>{money((menu.find(item => item.id === id)?.price || 0) * quantity)}</strong></div>)}<p>Check this before continuing. This replaces your bag, not your order.</p><button className="primary-button full-width" onClick={() => { setBag(voiceProposal); setModal('bag'); }}>Use this bag & review <ArrowRight size={16} /></button></div>}<div className="privacy-note"><ShieldCheck size={14} />You always review and confirm before an order is placed.</div></>}
      {modal === 'bag' && <><div className="eyebrow">GOOD CHOICES, ALL ROUND</div><h2 id="modal-heading">Your little delivery.</h2><p>From Peninsula Kitchen · Mornington</p>{count === 0 ? <div className="empty-bag"><ShoppingBag size={40} strokeWidth={1} /><h3>Something good belongs here.</h3><p>Pick a local favourite to get started.</p><button className="primary-button" onClick={() => { setModal(null); setPortal('customer'); }}>Explore the menu <ArrowRight size={15} /></button></div> : <><div className="bag-items">{menu.filter(item => bag[item.id]).map(item => <div className="bag-item" key={item.id}><div className="bag-food"><FoodArt kind={item.kind} /></div><div><strong>{item.name}</strong><small>{money(item.price)}</small><div className="quantity-control"><button aria-label={`Remove one ${item.name}`} onClick={() => changeQuantity(item, -1)}><Minus size={12} /></button><span>{bag[item.id]}</span><button aria-label={`Add one ${item.name}`} disabled={bag[item.id] >= 9} onClick={() => changeQuantity(item, 1)}><Plus size={12} /></button></div></div><strong>{money(item.price * bag[item.id])}</strong></div>)}</div><div className="bag-summary"><div><span>Subtotal</span><span>{money(bagTotal(bag))}</span></div><div><span>Demo delivery</span><span>On us</span></div><div className="bag-total"><strong>Total (AUD)</strong><strong>{money(bagTotal(bag))}</strong></div></div><button className="primary-button full-width" onClick={confirm}>Confirm demo order <ArrowRight size={16} /></button><p className="privacy-note"><ShieldCheck size={14} />No payment. No real delivery. Just a little possibility.</p></>}</>}
      {modal === 'maps' && <><span className="dialog-symbol"><MapPin size={28} /></span><div className="eyebrow">A REAL PLACE. A FICTIONAL FLEET.</div><h2 id="modal-heading">A Mornington perspective.</h2><p>The illustrated map works without credentials. Explore a real Azure Maps basemap with your own existing account. This may incur Azure usage charges; no resources are provisioned here.</p><label className="field-label" htmlFor="client-id">Azure Maps account client ID (not an app registration ID)</label><input id="client-id" value={mapClientId} onChange={event => setMapClientId(event.target.value)} placeholder="Your Maps account client ID" /><label className="field-label" htmlFor="map-token">Short-lived Entra access token for Azure Maps</label><input id="map-token" type="password" autoComplete="off" value={mapToken} onChange={event => setMapToken(event.target.value)} placeholder="Token with Azure Maps Data Reader access" /><p className="small-print">Kept only in this page’s memory. Reloading clears it. Token refresh is not implemented in the spike. Never paste an account key.</p>{mapError && <p className="form-error" role="alert">{mapError}</p>}<button className="primary-button full-width" onClick={() => { if (!mapClientId.trim() || !mapToken.trim()) { setMapError('Both the account client ID and a short-lived access token are required.'); return; } setMaps({ clientId: mapClientId.trim(), token: mapToken.trim() }); setMapToken(''); setMapError(''); setModal(null); }}>Explore Azure Maps <ArrowRight size={16} /></button><button className="text-button full-width" onClick={() => { setMaps(null); setMapToken(''); setMapError(''); setModal(null); }}>Use the illustrated map instead</button></>}
      {modal === 'about' && <><span className="dialog-symbol"><Drone size={28} /></span><div className="eyebrow">AN ASPIRE DESIGN SPIKE</div><h2 id="modal-heading">A little possibility.</h2><p>Skylane explores what a drone takeaway service could feel like in Mornington, Victoria. Every restaurant, order and flight in this preview is fictional.</p><div className="about-features"><span><Store size={18} />Explore the customer and kitchen views.</span><span><Navigation size={18} />Watch a browser-local delivery simulation.</span><span><Mic size={18} />Try scripted voice-to-menu matching.</span><span><MapPin size={18} />Explore Azure Maps with your own token.</span></div><p>This is not a finished service: orders reset on reload, microphone capture and real AI are not connected, and deployment is a later milestone.</p><button className="primary-button full-width" onClick={() => setModal(null)}>Back to the neighbourhood <ArrowLeft size={16} /></button></>}
    </div></div>}
    <a className="help-button" href="https://github.com/Azure/aspire-templates/issues/8" aria-label="Open design epic"><Headphones size={18} /></a>
  </div>;
}
