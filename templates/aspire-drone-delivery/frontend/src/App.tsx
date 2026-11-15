import { useEffect, useReducer, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock3, Coffee, Drone, Leaf, MapPin, Mic, Minus, Package, Pause, Play, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Store, X } from 'lucide-react';
import DeliveryMap from './DeliveryMap';
import type { MapSettings } from './DeliveryMap';
import BaySelector from './BaySelector';
import FoodArt, { CoffeeCup } from './FoodArt';
import OrderStatus from './OrderStatus';
import PayloadTray, { PayloadPicker } from './PayloadTray';
import { addToBag, bagCount, bagFromBays, baysFromBag, bagTotal, canPickup, coffeeDescription, demoFlights, demoReducer, emptyBays, initialState, linePrice, matchSpokenOrder, menuItem, money, orderFlight, payloadNames, resizeBays, validBag } from './demo';
import type { Bag, BagLine, Bays, PayloadSize } from './demo';

type Modal = 'voice' | 'bag' | 'bay' | 'maps' | 'about' | null;

const bayLabel = (bays: number) => `${bays} bay${bays === 1 ? '' : 's'}`;

export default function App() {
  const [portal, setPortal] = useState<'customer' | 'vendor'>('customer');
  const [state, dispatch] = useReducer(demoReducer, initialState);
  const [paused, setPaused] = useState(false);
  const [bays, setBays] = useState<Bays>([]);
  const [payload, setPayload] = useState<PayloadSize | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [activeBay, setActiveBay] = useState(0);
  const [transcript, setTranscript] = useState('One latte and two biscuits, please');
  const [voiceProposal, setVoiceProposal] = useState<Bag | null>(null);
  const [voiceError, setVoiceError] = useState('');
  const [maps, setMaps] = useState<MapSettings | null>(null);
  const [mapClientId, setMapClientId] = useState('');
  const [mapToken, setMapToken] = useState('');
  const [mapError, setMapError] = useState('');
  const [notice, setNotice] = useState('');
  const [route, setRoute] = useState(() => window.location.hash);
  const opener = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const bag = bagFromBays(bays), count = bagCount(bag), capacity = payload ?? 0;
  const activeOrders = state.orders.filter(order => order.stage !== 'Delivered');
  const statusId = /^#\/order\/(FC-\d+)$/.exec(route)?.[1];
  const fleet = [...demoFlights(state.ticks), ...['FC-05', 'FC-06'].map(id => {
    const order = activeOrders.find(entry => entry.drone?.id === id);
    return { id, status: order ? orderFlight(order).phase : 'Charging' };
  })];

  useEffect(() => {
    const update = () => { setRoute(window.location.hash); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', update);
    window.addEventListener('popstate', update);
    return () => { window.removeEventListener('hashchange', update); window.removeEventListener('popstate', update); };
  }, []);
  function navigate(hash: string) {
    if (hash) window.location.hash = hash;
    else { window.history.pushState(null, '', window.location.pathname + window.location.search); setRoute(''); window.scrollTo(0, 0); }
  }
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

  function setBag(next: Bag) {
    if (payload) setBays(baysFromBag(next, payload));
  }
  function choosePayload(size: PayloadSize) {
    if (count > size) return;
    setPayload(size);
    setBays(current => resizeBays(current, size));
    setVoiceProposal(null);
    setNotice(`${payloadNames[size]} selected. ${size - count} of ${size} bay${size === 1 ? '' : 's'} ready to fill.`);
  }
  function chooseFirst() {
    setModal(null);
    setPortal('customer');
    navigate('');
    window.setTimeout(() => {
      document.getElementById('payload')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.querySelector<HTMLButtonElement>('.payload-options button')?.focus({ preventScroll: true });
    }, 0);
    setNotice('Choose a single, double or quad payload first.');
  }
  function openBay(index: number) {
    if (!payload) { chooseFirst(); return; }
    setActiveBay(index);
    setModal('bay');
  }
  function openLine(line: BagLine) {
    const index = bays.findIndex(entry => entry?.id === line.id);
    if (index >= 0) openBay(index);
  }
  function clearBay(index: number) {
    setBays(current => current.map((line, i) => i === index ? null : line));
  }
  function removeOne(id: string) {
    const index = bays.map(line => line?.id).lastIndexOf(id);
    if (index >= 0) clearBay(index);
  }
  function fillBay(line: BagLine) {
    const editing = bays[activeBay] !== null;
    setBays(current => current.map((entry, i) => i === activeBay ? line : entry));
    setModal(null);
    setNotice(`${menuItem(line.itemId).name} ${editing ? 'updated in' : 'packed in'} bay ${activeBay + 1}.`);
  }
  function confirm() {
    if (!payload || !validBag(bag, payload)) return;
    const id = `FC-${state.nextId}`;
    dispatch({ type: 'confirm', bag, payload });
    setBays(payload ? emptyBays(payload) : []); setModal(null); setPortal('customer');
    navigate(`#/order/${id}`);
    setNotice('Order confirmed. Your barista is on it.');
  }
  function openVoice() { setVoiceError(''); setVoiceProposal(null); setModal('voice'); }
  function interpret() {
    const result = matchSpokenOrder(transcript);
    setVoiceProposal(result.error ? null : result.bag);
    setVoiceError(result.error || '');
  }

  return <div className="app-shell">
    <div className="demo-strip"><span>AN ASPIRE SHOWCASE / FICTIONAL COFFEE. REAL POSSIBILITIES.</span><span className="strip-message">Melbourne made. Sky delivered.</span><button onClick={() => setModal('about')}>Inside the demo <ArrowRight size={12} /></button></div>
    <header className="site-header">
      <a href="#" className="wordmark" aria-label="ForthCoffee home" onClick={event => { event.preventDefault(); setPortal('customer'); navigate(''); }}><span className="brand-symbol"><Coffee size={23} strokeWidth={1.6} /></span>Forth<span className="wordmark-light">Coffee</span><span className="brand-period">.</span></a>
      <div className="portal-switch" aria-label="Choose demo experience"><button className={portal === 'customer' ? 'selected' : ''} aria-pressed={portal === 'customer'} onClick={() => setPortal('customer')}><Coffee size={14} />Your coffee run</button><button className={portal === 'vendor' ? 'selected' : ''} aria-pressed={portal === 'vendor'} onClick={() => setPortal('vendor')}><Store size={14} />Barista & fleet</button></div>
      <div className="header-actions"><span className="location"><MapPin size={14} /> South Melbourne, VIC</span><button className="bag-button" onClick={() => setModal('bag')} aria-label={`Review payload, ${count} items`}><Package size={18} /><span className="bag-word">Your payload</span><span className="bag-count">{count}</span></button></div>
    </header>

    {portal === 'customer' && statusId ? <OrderStatus order={state.orders.find(order => order.id === statusId)} orderId={statusId} settings={maps} onSettings={() => setModal('maps')} onAdvance={() => dispatch({ type: 'advance', id: statusId })} onBack={() => navigate('')} />
      : portal === 'customer' ? <main>
        <section className="customer-intro"><div className="eyebrow"><span className="small-line" /> SOUTH MELBOURNE, MEET YOUR NEW COFFEE RUN.</div><h1>Good coffee. Great company. <em>A little <span className="altitude" aria-label="altitude">a<span className="proof-insert" aria-hidden="true"><span className="proof-l">l</span><span className="proof-caret">^</span></span>titude.</span></em></h1></section>
        <section className="packing-section" id="payload">
          <div className="packing-copy"><div className="eyebrow"><span className="step-count">01</span> BUILD YOUR PAYLOAD</div><h2>A little me time.<br />Or <em>make it a round.</em></h2><p>Pick your flight box, then tap a bay to fill it. Every bay carries one coffee or one treat.</p>
            <PayloadPicker value={payload} filled={count} onChange={choosePayload} />
            <p className="packing-hint">{payload ? 'Tap any bay to build a coffee or pick a treat.' : 'Start here: choose your single, double or quad.'} You don’t have to fill every bay.</p>
            {payload && <button className="primary-button" disabled={!count} onClick={() => setModal('bag')}>Review payload · {money(bagTotal(bag))}<ArrowRight size={15} /></button>}
          </div>
          <div className="packing-preview"><PayloadTray bays={bays} payload={payload} onSelect={openBay} onClear={clearBay} />
            <div className="packing-preview-bottom"><span>INSULATED CUPS. CAREFULLY NESTLED.<br /><small>Illustrative packaging, not real payload engineering.</small></span><span><Package size={15} />{payload ? payloadNames[payload].toUpperCase() : 'YOUR BOX, YOUR WAY'}</span></div>
          </div>
        </section>
        <section className="voice-banner"><span className="voice-banner-icon"><Mic size={25} /></span><div><span className="eyebrow">YOUR COFFEE RUN, IN A FEW WORDS.</span><h2>“One latte and two biscuits, please.”</h2><p>A shortcut for the usual. Always yours to review.</p></div><button className="outline-button" onClick={openVoice}>Try a voice-order preview <ArrowRight size={16} /></button><span className="preview-label">SCRIPTED / NO MICROPHONE</span></section>
        <section className="customer-map-section"><div className="section-heading"><div><div className="eyebrow">BREWED IN A COFFEE CAPITAL</div><h2>South Melbourne. <em>Above the everyday.</em></h2><p>From our fictional Coventry Street coffee bar to your neighbourhood.</p></div><button className="text-button" onClick={() => setPortal('vendor')}>Meet the fleet <ArrowRight size={15} /></button></div><DeliveryMap tick={state.ticks} orders={state.orders} settings={maps} onSettings={() => setModal('maps')} compact /></section>
        <div className="payload-dock"><div><Package size={20} /><span><strong>{payload ? `${payloadNames[payload]} payload` : 'Your next coffee run'}</strong><small>{payload ? `${count} ${count === 1 ? 'item' : 'items'} · ${bayLabel(capacity - count)} free` : 'Start with your flight box'}</small></span></div><button className="primary-button" onClick={() => payload ? setModal('bag') : chooseFirst()}>{payload ? `Review payload · ${money(bagTotal(bag))}` : 'Choose your payload'}<ArrowRight size={15} /></button></div>
      </main> : <main className="vendor-main">
        <div className="vendor-heading"><div><div className="eyebrow">FORTHCOFFEE / SOUTH MELBOURNE OPERATIONS</div><h1>From the bar,<br /><em>to the sky.</em></h1><p>Your coffees, customizations and fleet. All in one place.</p></div><div className="vendor-controls"><span className="live-pill"><span className="live-dot" />{paused ? 'Simulation paused' : 'Simulation live'}</span><button className="outline-button" onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Resume' : 'Pause'}</button><button className="icon-button" onClick={() => { dispatch({ type: 'reset' }); navigate(''); setNotice('Simulation reset to the opening scene.'); }} aria-label="Reset demo simulation"><RotateCcw size={16} /></button></div></div>
        <div className="stat-grid"><div><span>ON THE BAR <Coffee size={15} /></span><strong>{activeOrders.length.toString().padStart(2, '0')}</strong><small>Good mornings in the making</small></div><div><span>IN THE AIR <Drone size={16} /></span><strong>{fleet.filter(drone => drone.status !== 'Charging' && drone.status !== 'On the pad').length.toString().padStart(2, '0')}<em>/ 06</em></strong><small>{fleet.filter(drone => drone.status === 'Charging').length} drones charging at base</small></div><div><span>RECENTLY DELIVERED <Check size={16} /></span><strong>{state.orders.filter(order => order.stage === 'Delivered').length.toString().padStart(2, '0')}</strong><small>Recent completed demo deliveries</small></div><div><span>A DIFFERENT COFFEE RUN <Leaf size={16} /></span><strong>100<em>% demo</em></strong><small>No real flights or emissions claim.</small></div></div>
        <div className="operations-grid"><section className="operations-map"><div className="panel-heading"><h2>Our patch of sky<span className="live-dot" /></h2><button className="icon-button" aria-label="Map settings" onClick={() => setModal('maps')}><Settings2 size={17} /></button></div><DeliveryMap tick={state.ticks} orders={state.orders} settings={maps} onSettings={() => setModal('maps')} /><div className="map-legend"><span><i className="legend-store" />ForthCoffee bar</span><span><i className="legend-flight" />Simulated drone</span><span><i className="legend-route" />Demo route</span><span>Coventry Street · South Melbourne</span></div></section>
          <aside className="dispatch-panel"><div className="panel-heading"><h2>On the docket <span className="count-badge">{activeOrders.length}</span></h2><span className="eyebrow">LIVE QUEUE</span></div><p className="queue-intro">Brew. Pack. Give it a little lift.</p><div className="order-list">{activeOrders.map(order => <article className="queue-order" key={order.id}><div className="queue-order-top"><strong>{order.id} / {payloadNames[order.payload]}</strong><span className={`status-tag ${order.stage === 'Ready for pickup' ? 'ready' : order.stage === 'Delivering' ? 'flying' : ''}`}>{order.stage}</span></div><h3>{order.customer} <span>· South Melbourne{order.drone ? ` · ${order.drone.id}` : ''}</span></h3>{order.bag.map(line => <p key={line.id}><strong>{line.quantity}× {menuItem(line.itemId).name}</strong>{line.coffee && <span className="docket-options">{coffeeDescription(line.coffee)}</span>}</p>)}<div className="queue-order-bottom"><span><Clock3 size={12} />{order.stage === 'Preparing' ? 'Your barista is on it' : order.stage === 'Ready for pickup' ? (!order.drone ? 'Waiting for a drone' : canPickup(order) ? 'Drone at the bar' : 'Drone flying to pickup') : 'A little closer each second'}</span>{order.stage === 'Ready for pickup' && <button disabled={!canPickup(order)} onClick={() => { dispatch({ type: 'pickup', id: order.id }); setNotice(`${order.id}: demo pickup requested.`); }}>Request pickup <ArrowRight size={12} /></button>}</div></article>)}</div><div className="queue-note"><Coffee size={17} /><p>Synthetic orders arrive every 45 seconds. Ready orders dispatch after 30 seconds and their assigned drone lands at the bar.</p></div></aside></div>
        <div className="fleet-strip"><span className="eyebrow">ON THE ROSTER</span>{fleet.map((drone, index) => <div key={drone.id}><span className={`fleet-drone ${drone.status === 'Charging' ? 'charging' : ''}`}><Drone size={19} /></span><span><strong>{drone.id}</strong><small>{drone.status}</small></span><span className="battery">{[86, 74, 62, 91, 48, 73][index]}%</span></div>)}</div>
      </main>}

    <footer><a className="footer-brand" href="#" onClick={event => { event.preventDefault(); setPortal('customer'); navigate(''); }}>ForthCoffee.</a><span>Great coffee. A little altitude. Built with Aspire.</span><button onClick={() => setModal('about')}>A fictional company, by design <ArrowRight size={13} /></button><span className="footer-coordinates">SOUTH MELBOURNE · 37.83° S, 144.96° E</span></footer>
    {notice && <div role="status" className="toast"><Check size={17} />{notice}</div>}
    {modal && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className={`modal ${modal === 'bay' ? 'coffee-modal' : modal === 'bag' ? 'bag-modal' : ''}`} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="modal-heading"><button className="modal-close icon-button" onClick={() => setModal(null)} aria-label="Close dialog"><X size={20} /></button>
      {modal === 'bay' && payload && <BaySelector key={activeBay} bay={activeBay} current={bays[activeBay] ?? null} onSave={fillBay} />}
      {modal === 'voice' && <><span className="dialog-symbol"><Mic size={28} /></span><div className="eyebrow">THE USUAL, IN YOUR WORDS</div><h2 id="modal-heading">What are we brewing?</h2><p>A scripted voice-ordering preview. No microphone, recording or AI service. Coffees start regular, hot, double-shot; milk defaults to full cream, or none for black coffee. Customize them in the builder after review.</p><label className="field-label" htmlFor="transcript">Editable example transcript</label><textarea id="transcript" value={transcript} onChange={event => { setTranscript(event.target.value); setVoiceProposal(null); setVoiceError(''); }} /><button className="primary-button full-width" onClick={interpret}><Sparkles size={16} />Match to the menu</button>{voiceError && <p className="form-error" role="alert">{voiceError}</p>}{voiceProposal && <div className="voice-proposal"><div className="eyebrow"><Check size={14} /> YOUR PROPOSED COFFEE RUN</div>{voiceProposal.map(line => <div key={line.id}><span>{line.quantity} × {menuItem(line.itemId).name}</span><strong>{money(linePrice(line) * line.quantity)}</strong></div>)}<p>This replaces your payload’s contents only when you choose it. No order has been placed.</p>{payload && bagCount(voiceProposal) > capacity && <p className="form-error" role="alert">This needs {bayLabel(bagCount(voiceProposal))}. Choose a larger payload first.</p>}<button className="primary-button full-width" disabled={payload !== null && !validBag(voiceProposal, payload)} onClick={() => { if (!payload) { chooseFirst(); return; } setBag(voiceProposal); setModal('bag'); }}>{payload ? 'Use these items & review' : 'Choose a payload first'}<ArrowRight size={16} /></button></div>}<p className="privacy-note"><ShieldCheck size={14} />You always review and confirm before ordering.</p></>}
      {modal === 'bag' && <><div className="eyebrow">03 / READY FOR TAKE-OFF?</div><h2 id="modal-heading">Your coffee run.</h2><p>ForthCoffee · South Melbourne · {payload ? `${payloadNames[payload]} payload` : 'No payload selected'}</p>
        {payload ? <><PayloadPicker value={payload} filled={count} onChange={choosePayload} /><p className="packing-hint">{bayLabel(capacity - count)} free. Smaller boxes unlock when their contents fit.</p></> : <button className="primary-button full-width" onClick={chooseFirst}>Choose your payload <ArrowRight size={15} /></button>}
        {!count ? <div className="empty-bag"><Coffee size={40} strokeWidth={1} /><h3>Your next good morning goes here.</h3><button className="outline-button" onClick={() => { setModal(null); setPortal('customer'); navigate(''); window.setTimeout(() => document.getElementById('payload')?.scrollIntoView({ behavior: 'smooth' }), 0); }}>Fill a bay <ArrowRight size={15} /></button></div> : <><div className="bag-items">{bag.map(line => { const item = menuItem(line.itemId); return <div className="bag-item" key={line.id}><div className="bag-food">{line.coffee ? <CoffeeCup options={line.coffee} style={line.itemId} /> : <FoodArt kind={item.kind} />}</div><div><strong>{item.name}</strong>{line.coffee && <small>{coffeeDescription(line.coffee)}</small>}<small>{money(linePrice(line))} each · one bay each</small><div className="bag-line-actions"><div className="quantity-control"><button aria-label={`Remove one ${item.name}`} onClick={() => removeOne(line.id)}><Minus size={13} /></button><span>{line.quantity}</span><button aria-label={`Add one ${item.name}`} disabled={!payload || count >= capacity} onClick={() => { if (payload) setBag(addToBag(bag, { ...line, quantity: 1 }, payload)); }}><Plus size={13} /></button></div>{line.coffee && <button className="edit-coffee" onClick={() => openLine(line)}>Edit coffee</button>}</div></div><strong>{money(linePrice(line) * line.quantity)}</strong></div>; })}</div><div className="bag-summary"><div><span>Payload space</span><span>{count} of {bayLabel(capacity)} filled</span></div><div><span>Demo delivery</span><span>On us</span></div><div className="bag-total"><strong>Total (AUD)</strong><strong>{money(bagTotal(bag))}</strong></div></div><button className="primary-button full-width" disabled={!payload || !validBag(bag, payload)} onClick={confirm}>Confirm demo order <ArrowRight size={16} /></button><button className="text-button full-width" onClick={() => setModal(null)}>Keep packing <Plus size={14} /></button><p className="privacy-note"><ShieldCheck size={14} />Fictional order. No payment, no real flight. Dietary suitability is not guaranteed.</p></>}
      </>}
      {modal === 'maps' && <><span className="dialog-symbol"><MapPin size={28} /></span><div className="eyebrow">A REAL PLACE. A FICTIONAL COFFEE BAR.</div><h2 id="modal-heading">A South Melbourne perspective.</h2><p>The illustrated map needs no credentials. Explore Azure Maps with your own existing account. Usage may incur charges; no resources are provisioned.</p><label className="field-label" htmlFor="client-id">Azure Maps account client ID (not an app registration ID)</label><input id="client-id" value={mapClientId} onChange={event => setMapClientId(event.target.value)} placeholder="Your Maps account client ID" /><label className="field-label" htmlFor="map-token">Short-lived Entra access token for Azure Maps</label><input id="map-token" type="password" autoComplete="off" value={mapToken} onChange={event => setMapToken(event.target.value)} placeholder="Token with Azure Maps Data Reader access" /><p className="small-print">Kept only in this page’s memory. Reloading clears it. Token refresh is not implemented. Never paste an account key.</p>{mapError && <p className="form-error" role="alert">{mapError}</p>}<button className="primary-button full-width" onClick={() => { if (!mapClientId.trim() || !mapToken.trim()) { setMapError('Both the account client ID and a short-lived access token are required.'); return; } setMaps({ clientId: mapClientId.trim(), token: mapToken.trim() }); setMapToken(''); setMapError(''); setModal(null); }}>Explore Azure Maps <ArrowRight size={16} /></button><button className="text-button full-width" onClick={() => { setMaps(null); setMapToken(''); setMapError(''); setModal(null); }}>Use the illustrated map instead</button></>}
      {modal === 'about' && <><span className="dialog-symbol"><Coffee size={28} /></span><div className="eyebrow">AN ASPIRE DESIGN SPIKE</div><h2 id="modal-heading">Good coffee. New possibilities.</h2><p>ForthCoffee is one fictional company exploring drone-delivered coffee in South Melbourne. No real company, shop, order or flight is represented.</p><div className="about-features"><span><Package size={18} />Choose a single, double or quad payload.</span><span><Coffee size={18} />Build each coffee and tuck in some treats.</span><span><Drone size={18} />Follow your order overhead and through a simulated camera.</span><span><Mic size={18} />Try scripted voice-to-menu matching.</span></div><p>Packaging capacity is illustrative, not flight engineering. Orders reset on reload. Real speech, AI, backend orders and deployment are later milestones.</p><button className="primary-button full-width" onClick={() => setModal(null)}>Back to your coffee run <ArrowLeft size={16} /></button></>}
    </div></div>}
  </div>;
}
