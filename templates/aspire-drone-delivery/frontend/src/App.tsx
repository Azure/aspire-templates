import { useEffect, useReducer, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Clock3, Coffee, Drone, Leaf, MapPin, Mic, Minus, Package, Pause, Play, Plus, RotateCcw, Search, Settings2, ShieldCheck, Sparkles, Store, X } from 'lucide-react';
import DeliveryMap from './DeliveryMap';
import type { MapSettings } from './DeliveryMap';
import CoffeeBuilder from './CoffeeBuilder';
import FoodArt, { CoffeeCup } from './FoodArt';
import OrderStatus from './OrderStatus';
import PayloadTray, { PayloadPicker } from './PayloadTray';
import { addToBag, bagCount, bagTotal, bagUnits, coffeeDescription, defaultCoffee, demoFlights, demoReducer, initialState, linePrice, makeLine, matchSpokenOrder, menu, menuItem, money, orderFlight, payloadNames, spaceLabel, validBag } from './demo';
import type { Bag, BagLine, MenuItem, PayloadSize } from './demo';

type Modal = 'voice' | 'bag' | 'coffee' | 'maps' | 'about' | null;
const categories = ['Everything', 'Coffee', 'Something sweet', 'From the oven'];

export default function App() {
  const [portal, setPortal] = useState<'customer' | 'vendor'>('customer');
  const [state, dispatch] = useReducer(demoReducer, initialState);
  const [paused, setPaused] = useState(false);
  const [bag, setBag] = useState<Bag>([]);
  const [payload, setPayload] = useState<PayloadSize | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [builder, setBuilder] = useState<{ item: MenuItem; editing?: BagLine }>({ item: menu[0] });
  const [category, setCategory] = useState(0);
  const [query, setQuery] = useState('');
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
  const used = bagUnits(bag), capacity = (payload ?? 0) * 4, count = bagCount(bag);
  const myOrder = state.orders.find(order => order.customer === 'You');
  const visibleItems = menu.filter(item =>
    (category === 0 || category === 1 && item.kind === 'coffee' || category === 2 && ['biscuit', 'cake'].includes(item.kind) || category === 3 && item.kind === 'croissant') &&
    `${item.name} ${item.detail}`.toLowerCase().includes(query.toLowerCase()));
  const activeOrders = state.orders.filter(order => order.stage !== 'Delivered');
  const statusId = /^#\/order\/(FC-\d+)$/.exec(route)?.[1];
  const myFlight = myOrder && myOrder.stage !== 'Delivered' && myOrder.stage !== 'Preparing' ? orderFlight(myOrder) : undefined;
  const fleet = [...demoFlights(state.ticks), ...['FC-05', 'FC-06'].map(id => ({ id, status: myFlight?.droneId === id ? (myFlight.phase === 'In flight' ? 'Delivering' : 'On the pad') : 'Charging' }))];

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

  function choosePayload(size: PayloadSize) {
    if (used > size * 4) return;
    setPayload(size);
    setVoiceProposal(null);
    setNotice(`${payloadNames[size]} selected. ${spaceLabel(size * 4 - used)} ready to fill.`);
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
  function openCoffee(item = menu[0], editing?: BagLine) {
    if (!payload) { chooseFirst(); return; }
    setBuilder({ item, editing });
    setModal('coffee');
  }
  function removeOne(id: string) {
    setBag(current => current.flatMap(line => line.id !== id ? [line] : line.quantity > 1 ? [{ ...line, quantity: line.quantity - 1 }] : []));
  }
  function addItem(item: MenuItem) {
    if (!payload) { chooseFirst(); return; }
    if (item.kind === 'coffee') { openCoffee(item); return; }
    setBag(addToBag(bag, makeLine(item.id), payload));
    setNotice(`${item.name} packed. A very good decision.`);
  }
  function saveCoffee(line: BagLine) {
    if (!payload) return;
    const others = bag.filter(entry => entry.id !== builder.editing?.id);
    setBag(addToBag(others, line, payload));
    setModal(builder.editing ? 'bag' : null);
    setNotice(`${menuItem(line.itemId).name} ${builder.editing ? 'updated' : 'packed'}. Made your way.`);
  }
  function confirm() {
    if (!payload || !validBag(bag, payload)) return;
    const id = `FC-${state.nextId}`;
    dispatch({ type: 'confirm', bag, payload });
    setBag([]); setModal(null); setPortal('customer');
    navigate(`#/order/${id}`);
    setNotice('Order confirmed. Your barista is on it.');
  }
  function openVoice() { setVoiceError(''); setVoiceProposal(null); setModal('voice'); }
  function interpret() {
    const result = matchSpokenOrder(transcript);
    setVoiceProposal(result.error ? null : result.bag);
    setVoiceError(result.error || '');
  }
  const editingUnits = builder.editing ? menuItem(builder.editing.itemId).units * builder.editing.quantity : 0;

  return <div className="app-shell">
    <div className="demo-strip"><span>AN ASPIRE SHOWCASE / FICTIONAL COFFEE. REAL POSSIBILITIES.</span><span className="strip-message">Melbourne made. Sky delivered.</span><button onClick={() => setModal('about')}>Inside the demo <ArrowRight size={12} /></button></div>
    <header className="site-header">
      <a href="#" className="wordmark" aria-label="ForthCoffee home" onClick={event => { event.preventDefault(); setPortal('customer'); navigate(''); }}><span className="brand-symbol"><Coffee size={23} strokeWidth={1.6} /></span>Forth<span className="wordmark-light">Coffee</span><span className="brand-period">.</span></a>
      <div className="portal-switch" aria-label="Choose demo experience"><button className={portal === 'customer' ? 'selected' : ''} aria-pressed={portal === 'customer'} onClick={() => setPortal('customer')}><Coffee size={14} />Your coffee run</button><button className={portal === 'vendor' ? 'selected' : ''} aria-pressed={portal === 'vendor'} onClick={() => setPortal('vendor')}><Store size={14} />Barista & fleet</button></div>
      <div className="header-actions"><span className="location"><MapPin size={14} /> South Melbourne, VIC</span><button className="bag-button" onClick={() => setModal('bag')} aria-label={`Review payload, ${count} items`}><Package size={18} /><span className="bag-word">Your payload</span><span className="bag-count">{count}</span></button></div>
    </header>

    {portal === 'customer' && statusId ? <OrderStatus order={state.orders.find(order => order.id === statusId)} orderId={statusId} settings={maps} onSettings={() => setModal('maps')} onAdvance={() => dispatch({ type: 'advance', id: statusId })} onBack={() => navigate('')} />
      : portal === 'customer' ? <main>
        <section className="coffee-hero">
          <div className="hero-copy"><div className="eyebrow"><span className="small-line" /> SOUTH MELBOURNE, MEET YOUR NEW COFFEE RUN.</div><h1>Good coffee.<br />Great company.<br /><em>A little altitude.</em></h1><p>From our South Melbourne bar to wherever you are.<br />Your usual, made yours. Delivered by drone.</p>
            <div className="hero-buttons"><button className="primary-button" onClick={() => document.getElementById('payload')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Build your coffee run <ArrowRight size={16} /></button><span className="hero-stamp"><Drone size={15} />Roasted. Brewed. Airborne.</span></div>
            <div className="hero-footnote"><span><Coffee size={14} />One coffee-loving company</span><span><MapPin size={14} />One very Melbourne morning</span></div>
          </div>
          <div className="coffee-hero-art"><div className="visual-topline"><span className="live-dot" />THE SOUTH MELBOURNE COFFEE RUN<span>37.83° S / 144.96° E</span></div>
            <div className="hero-circle" /><span className="coffee-art-caption">YOUR MORNING,<br /><em>on the up.</em></span>
            <div className="hero-cup hero-cup-back"><CoffeeCup options={{ ...defaultCoffee('latte'), temperature: 'Iced', milk: 'Oat' }} style="latte" /></div>
            <div className="hero-cup hero-cup-front"><CoffeeCup options={defaultCoffee('flat-white')} /></div>
            <div className="coffee-flight-tag"><Drone size={22} strokeWidth={1.5} /><div><strong>Next stop: your first sip.</strong><small>ForthCoffee → South Melbourne → You</small></div><span className="live-dot" /></div>
            <div className="visual-bottomline"><span>EXCEPTIONAL COFFEE. UNCONVENTIONAL COMMUTE.</span><span>EST. FOR THE DEMO</span></div>
          </div>
        </section>
        <div className="community-strip"><span>LESS COMMUTE. MORE COFFEE.</span><p>A flat white for one. A round for the team. There’s a flight box for that.</p><span className="community-right"><ShieldCheck size={15} />Demo orders only. No payment or real flight.</span></div>

        {myOrder && <section className="tracking-panel"><div><span className="eyebrow">YOUR COFFEE RUN · {myOrder.id}</span><h2>{myOrder.stage === 'Delivered' ? 'Your morning has landed.' : 'Good coffee is getting closer.'}</h2><p>{myOrder.stage} · {payloadNames[myOrder.payload]} payload · {money(bagTotal(myOrder.bag))}</p><button className="primary-button" onClick={() => navigate(`#/order/${myOrder.id}`)}>View order status <ArrowRight size={15} /></button></div><Coffee size={38} strokeWidth={1} /></section>}

        <section className="packing-section" id="payload">
          <div className="packing-copy"><div className="eyebrow"><span className="step-count">01</span> CHOOSE YOUR PAYLOAD</div><h2>A little me time.<br />Or <em>make it a round.</em></h2><p>Pick your flight box, then fill it with your favourites. Each coffee takes one cup well. Treats tuck into the spare space.</p>
            <PayloadPicker value={payload} used={used} onChange={choosePayload} />
            <p className="packing-hint">{payload ? 'Box selected. Time to play barista ↓' : 'Start here: choose your single, double or quad.'} You don’t have to fill every well.</p>
          </div>
          <div className="packing-preview"><PayloadTray bag={bag} payload={payload} onAdd={() => openCoffee()} onEdit={line => openCoffee(menuItem(line.itemId), line)} onRemove={removeOne} />
            <div className="packing-preview-bottom"><span>INSULATED CUPS. CAREFULLY NESTLED.<br /><small>Illustrative packaging, not real payload engineering.</small></span><span><Package size={15} />{payload ? payloadNames[payload].toUpperCase() : 'YOUR BOX, YOUR WAY'}</span></div>
          </div>
        </section>
        <section className="menu-section" id="menu">
          <div className="section-heading"><div><div className="eyebrow"><span className="step-count">02</span> FILL IT WITH GOOD THINGS</div><h2>The usual. <em>Or your new usual.</em></h2><p>Every coffee is made to order. Tap a cup to find your perfect combination.</p></div><label className="search-field"><Search size={16} /><input placeholder="Find your favourite…" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search menu" /></label></div>
          <div className="category-row">{categories.map((name, index) => <button key={name} onClick={() => setCategory(index)} aria-pressed={category === index} className={category === index ? 'active' : ''}>{index === 0 && <Sparkles size={14} />}{name}</button>)}<span className="delivery-estimate">{payload ? `${spaceLabel(capacity - used)} left in your ${payloadNames[payload].toLowerCase()}` : 'Choose a payload above to start packing'}<Package size={14} /></span></div>
          <div className="menu-grid">{visibleItems.map(item => {
            const packed = bag.filter(line => line.itemId === item.id).reduce((sum, line) => sum + line.quantity, 0);
            const full = payload !== null && (used + item.units > capacity || item.kind !== 'coffee' && packed >= 9);
            return <article className={`menu-card menu-${item.kind}`} key={item.id}><div className="food-frame">{item.kind === 'coffee' ? <CoffeeCup options={defaultCoffee(item.id)} style={item.id} /> : <FoodArt kind={item.kind} />}<span className="food-label">{item.tag}</span>{packed > 0 && <span className="packed-badge"><Check size={11} />{packed} packed</span>}</div><div className="menu-card-body"><div className="restaurant-name">FORTHCOFFEE <span>{item.kind === 'coffee' ? '1 CUP WELL' : spaceLabel(item.units).toUpperCase()}</span></div><h3>{item.name}</h3><p>{item.detail}</p><div className="food-bottom"><strong>{item.kind === 'coffee' && <small>from </small>}{money(item.price)}</strong><button className="menu-add" onClick={() => addItem(item)} disabled={full} aria-label={`${item.kind === 'coffee' ? 'Build' : 'Add'} ${item.name}`}>{full ? 'Box full' : item.kind === 'coffee' ? 'Make it yours' : 'Tuck one in'}{!full && <Plus size={14} />}</button></div></div></article>;
          })}</div>
          {visibleItems.length === 0 && <p className="empty-state">No matches. Try “latte”, “cake” or another favourite.</p>}
          <div className="menu-footnote"><span><Coffee size={14} />Small / regular +50c / large +$1 · plant milk +80c · third shot +70c</span><span>Treats: biscuit ¼ well · cake & croissant ½ well</span></div>
        </section>
        <section className="voice-banner"><span className="voice-banner-icon"><Mic size={25} /></span><div><span className="eyebrow">YOUR COFFEE RUN, IN A FEW WORDS.</span><h2>“One latte and two biscuits, please.”</h2><p>A shortcut for the usual. Always yours to review.</p></div><button className="outline-button" onClick={openVoice}>Try a voice-order preview <ArrowRight size={16} /></button><span className="preview-label">SCRIPTED / NO MICROPHONE</span></section>
        <section className="customer-map-section"><div className="section-heading"><div><div className="eyebrow">BREWED IN A COFFEE CAPITAL</div><h2>South Melbourne. <em>Above the everyday.</em></h2><p>From our fictional Coventry Street coffee bar to your neighbourhood.</p></div><button className="text-button" onClick={() => setPortal('vendor')}>Meet the fleet <ArrowRight size={15} /></button></div><DeliveryMap tick={state.ticks} orders={state.orders} settings={maps} onSettings={() => setModal('maps')} compact /></section>
        <div className="payload-dock"><div><Package size={20} /><span><strong>{payload ? `${payloadNames[payload]} payload` : 'Your next coffee run'}</strong><small>{payload ? `${count} ${count === 1 ? 'item' : 'items'} · ${spaceLabel(capacity - used)} free` : 'Start with your flight box'}</small></span></div><button className="primary-button" onClick={() => payload ? setModal('bag') : chooseFirst()}>{payload ? `Review payload · ${money(bagTotal(bag))}` : 'Choose your payload'}<ArrowRight size={15} /></button></div>
      </main> : <main className="vendor-main">
        <div className="vendor-heading"><div><div className="eyebrow">FORTHCOFFEE / SOUTH MELBOURNE OPERATIONS</div><h1>From the bar,<br /><em>to the sky.</em></h1><p>Your coffees, customizations and fleet. All in one place.</p></div><div className="vendor-controls"><span className="live-pill"><span className="live-dot" />{paused ? 'Simulation paused' : 'Simulation live'}</span><button className="outline-button" onClick={() => setPaused(!paused)}>{paused ? <Play size={14} /> : <Pause size={14} />}{paused ? 'Resume' : 'Pause'}</button><button className="icon-button" onClick={() => { dispatch({ type: 'reset' }); navigate(''); setNotice('Simulation reset to the opening scene.'); }} aria-label="Reset demo simulation"><RotateCcw size={16} /></button></div></div>
        <div className="stat-grid"><div><span>ON THE BAR <Coffee size={15} /></span><strong>{activeOrders.length.toString().padStart(2, '0')}</strong><small>Good mornings in the making</small></div><div><span>IN THE AIR <Drone size={16} /></span><strong>{fleet.filter(drone => drone.status !== 'Charging' && drone.status !== 'On the pad').length.toString().padStart(2, '0')}<em>/ 06</em></strong><small>{fleet.filter(drone => drone.status === 'Charging').length} drones charging at base</small></div><div><span>RECENTLY DELIVERED <Check size={16} /></span><strong>{state.orders.filter(order => order.stage === 'Delivered').length.toString().padStart(2, '0')}</strong><small>Recent completed demo deliveries</small></div><div><span>A DIFFERENT COFFEE RUN <Leaf size={16} /></span><strong>100<em>% demo</em></strong><small>No real flights or emissions claim.</small></div></div>
        <div className="operations-grid"><section className="operations-map"><div className="panel-heading"><h2>Our patch of sky<span className="live-dot" /></h2><button className="icon-button" aria-label="Map settings" onClick={() => setModal('maps')}><Settings2 size={17} /></button></div><DeliveryMap tick={state.ticks} orders={state.orders} settings={maps} onSettings={() => setModal('maps')} /><div className="map-legend"><span><i className="legend-store" />ForthCoffee bar</span><span><i className="legend-flight" />Simulated drone</span><span><i className="legend-route" />Demo route</span><span>Coventry Street · South Melbourne</span></div></section>
          <aside className="dispatch-panel"><div className="panel-heading"><h2>On the docket <span className="count-badge">{activeOrders.length}</span></h2><span className="eyebrow">LIVE QUEUE</span></div><p className="queue-intro">Brew. Pack. Give it a little lift.</p><div className="order-list">{activeOrders.map(order => <article className="queue-order" key={order.id}><div className="queue-order-top"><strong>{order.id} / {payloadNames[order.payload]}</strong><span className={`status-tag ${order.stage === 'Ready for pickup' ? 'ready' : order.stage === 'Delivering' ? 'flying' : ''}`}>{order.stage}</span></div><h3>{order.customer} <span>· South Melbourne{order.customer === 'You' && order.stage !== 'Preparing' ? ` · ${orderFlight(order).droneId}` : ''}</span></h3>{order.bag.map(line => <p key={line.id}><strong>{line.quantity}× {menuItem(line.itemId).name}</strong>{line.coffee && <span className="docket-options">{coffeeDescription(line.coffee)}</span>}</p>)}<div className="queue-order-bottom"><span><Clock3 size={12} />{order.stage === 'Preparing' ? 'Your barista is on it' : order.stage === 'Ready for pickup' ? 'Auto-pickup in a moment' : 'A little closer each second'}</span>{order.stage === 'Ready for pickup' && <button onClick={() => { dispatch({ type: 'pickup', id: order.id }); setNotice(`${order.id}: demo pickup requested.`); }}>Request pickup <ArrowRight size={12} /></button>}</div></article>)}</div><div className="queue-note"><Coffee size={17} /><p>Synthetic orders arrive every 45 seconds. Ready orders wait 30 seconds, then dispatch automatically.</p></div></aside></div>
        <div className="fleet-strip"><span className="eyebrow">ON THE ROSTER</span>{fleet.map((drone, index) => <div key={drone.id}><span className={`fleet-drone ${drone.status === 'Charging' ? 'charging' : ''}`}><Drone size={19} /></span><span><strong>{drone.id}</strong><small>{drone.status}</small></span><span className="battery">{[86, 74, 62, 91, 48, 73][index]}%</span></div>)}</div>
      </main>}

    <footer><a className="footer-brand" href="#" onClick={event => { event.preventDefault(); setPortal('customer'); navigate(''); }}>ForthCoffee.</a><span>Great coffee. A little altitude. Built with Aspire.</span><button onClick={() => setModal('about')}>A fictional company, by design <ArrowRight size={13} /></button><span className="footer-coordinates">SOUTH MELBOURNE · 37.83° S, 144.96° E</span></footer>
    {notice && <div role="status" className="toast"><Check size={17} />{notice}</div>}
    {modal && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className={`modal ${modal === 'coffee' ? 'coffee-modal' : modal === 'bag' ? 'bag-modal' : ''}`} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="modal-heading"><button className="modal-close icon-button" onClick={() => setModal(null)} aria-label="Close dialog"><X size={20} /></button>
      {modal === 'coffee' && <CoffeeBuilder key={builder.editing?.id ?? builder.item.id} item={builder.item} editing={builder.editing} remainingUnits={capacity - used + editingUnits} onSave={saveCoffee} />}
      {modal === 'voice' && <><span className="dialog-symbol"><Mic size={28} /></span><div className="eyebrow">THE USUAL, IN YOUR WORDS</div><h2 id="modal-heading">What are we brewing?</h2><p>A scripted voice-ordering preview. No microphone, recording or AI service. Coffees start regular, hot, double-shot; milk defaults to full cream, or none for black coffee. Customize them in the builder after review.</p><label className="field-label" htmlFor="transcript">Editable example transcript</label><textarea id="transcript" value={transcript} onChange={event => { setTranscript(event.target.value); setVoiceProposal(null); setVoiceError(''); }} /><button className="primary-button full-width" onClick={interpret}><Sparkles size={16} />Match to the menu</button>{voiceError && <p className="form-error" role="alert">{voiceError}</p>}{voiceProposal && <div className="voice-proposal"><div className="eyebrow"><Check size={14} /> YOUR PROPOSED COFFEE RUN</div>{voiceProposal.map(line => <div key={line.id}><span>{line.quantity} × {menuItem(line.itemId).name}</span><strong>{money(linePrice(line) * line.quantity)}</strong></div>)}<p>This replaces your payload’s contents only when you choose it. No order has been placed.</p>{payload && bagUnits(voiceProposal) > capacity && <p className="form-error" role="alert">This needs {spaceLabel(bagUnits(voiceProposal))}. Choose a larger payload first.</p>}<button className="primary-button full-width" disabled={payload !== null && !validBag(voiceProposal, payload)} onClick={() => { if (!payload) { chooseFirst(); return; } setBag(voiceProposal); setModal('bag'); }}>{payload ? 'Use these items & review' : 'Choose a payload first'}<ArrowRight size={16} /></button></div>}<p className="privacy-note"><ShieldCheck size={14} />You always review and confirm before ordering.</p></>}
      {modal === 'bag' && <><div className="eyebrow">03 / READY FOR TAKE-OFF?</div><h2 id="modal-heading">Your coffee run.</h2><p>ForthCoffee · South Melbourne · {payload ? `${payloadNames[payload]} payload` : 'No payload selected'}</p>
        {payload ? <><PayloadPicker value={payload} used={used} onChange={choosePayload} /><p className="packing-hint">{spaceLabel(capacity - used)} free. Smaller boxes unlock when their contents fit.</p></> : <button className="primary-button full-width" onClick={chooseFirst}>Choose your payload <ArrowRight size={15} /></button>}
        {!count ? <div className="empty-bag"><Coffee size={40} strokeWidth={1} /><h3>Your next good morning goes here.</h3><button className="outline-button" onClick={() => { setModal(null); setPortal('customer'); navigate(''); window.setTimeout(() => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' }), 0); }}>Back to the menu <ArrowRight size={15} /></button></div> : <><div className="bag-items">{bag.map(line => { const item = menuItem(line.itemId); return <div className="bag-item" key={line.id}><div className="bag-food">{line.coffee ? <CoffeeCup options={line.coffee} style={line.itemId} /> : <FoodArt kind={item.kind} />}</div><div><strong>{item.name}</strong>{line.coffee && <small>{coffeeDescription(line.coffee)}</small>}<small>{money(linePrice(line))} each · {spaceLabel(item.units)}</small><div className="bag-line-actions"><div className="quantity-control"><button aria-label={`Remove one ${item.name}`} onClick={() => removeOne(line.id)}><Minus size={13} /></button><span>{line.quantity}</span><button aria-label={`Add one ${item.name}`} disabled={!payload || used + item.units > capacity || line.quantity >= 9} onClick={() => { if (payload) setBag(addToBag(bag, { ...line, quantity: 1 }, payload)); }}><Plus size={13} /></button></div>{line.coffee && <button className="edit-coffee" onClick={() => openCoffee(item, line)}>Edit coffee</button>}</div></div><strong>{money(linePrice(line) * line.quantity)}</strong></div>; })}</div><div className="bag-summary"><div><span>Payload space</span><span>{spaceLabel(used)} / {payload}</span></div><div><span>Demo delivery</span><span>On us</span></div><div className="bag-total"><strong>Total (AUD)</strong><strong>{money(bagTotal(bag))}</strong></div></div><button className="primary-button full-width" disabled={!payload || !validBag(bag, payload)} onClick={confirm}>Confirm demo order <ArrowRight size={16} /></button><button className="text-button full-width" onClick={() => setModal(null)}>Keep packing <Plus size={14} /></button><p className="privacy-note"><ShieldCheck size={14} />Fictional order. No payment, no real flight. Dietary suitability is not guaranteed.</p></>}
      </>}
      {modal === 'maps' && <><span className="dialog-symbol"><MapPin size={28} /></span><div className="eyebrow">A REAL PLACE. A FICTIONAL COFFEE BAR.</div><h2 id="modal-heading">A South Melbourne perspective.</h2><p>The illustrated map needs no credentials. Explore Azure Maps with your own existing account. Usage may incur charges; no resources are provisioned.</p><label className="field-label" htmlFor="client-id">Azure Maps account client ID (not an app registration ID)</label><input id="client-id" value={mapClientId} onChange={event => setMapClientId(event.target.value)} placeholder="Your Maps account client ID" /><label className="field-label" htmlFor="map-token">Short-lived Entra access token for Azure Maps</label><input id="map-token" type="password" autoComplete="off" value={mapToken} onChange={event => setMapToken(event.target.value)} placeholder="Token with Azure Maps Data Reader access" /><p className="small-print">Kept only in this page’s memory. Reloading clears it. Token refresh is not implemented. Never paste an account key.</p>{mapError && <p className="form-error" role="alert">{mapError}</p>}<button className="primary-button full-width" onClick={() => { if (!mapClientId.trim() || !mapToken.trim()) { setMapError('Both the account client ID and a short-lived access token are required.'); return; } setMaps({ clientId: mapClientId.trim(), token: mapToken.trim() }); setMapToken(''); setMapError(''); setModal(null); }}>Explore Azure Maps <ArrowRight size={16} /></button><button className="text-button full-width" onClick={() => { setMaps(null); setMapToken(''); setMapError(''); setModal(null); }}>Use the illustrated map instead</button></>}
      {modal === 'about' && <><span className="dialog-symbol"><Coffee size={28} /></span><div className="eyebrow">AN ASPIRE DESIGN SPIKE</div><h2 id="modal-heading">Good coffee. New possibilities.</h2><p>ForthCoffee is one fictional company exploring drone-delivered coffee in South Melbourne. No real company, shop, order or flight is represented.</p><div className="about-features"><span><Package size={18} />Choose a single, double or quad payload.</span><span><Coffee size={18} />Build each coffee and tuck in some treats.</span><span><Drone size={18} />Follow your order overhead and through a simulated camera.</span><span><Mic size={18} />Try scripted voice-to-menu matching.</span></div><p>Packaging capacity is illustrative, not flight engineering. Orders reset on reload. Real speech, AI, backend orders and deployment are later milestones.</p><button className="primary-button full-width" onClick={() => setModal(null)}>Back to your coffee run <ArrowLeft size={16} /></button></>}
    </div></div>}
  </div>;
}
