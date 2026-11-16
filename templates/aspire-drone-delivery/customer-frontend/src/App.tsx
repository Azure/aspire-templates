import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Coffee, Drone, MapPin, Minus, Package, Plus, ShieldCheck, X } from 'lucide-react';
import type { MapSettings } from './DeliveryMap';
import BaySelector from './BaySelector';
import FoodArt, { CoffeeCup } from './FoodArt';
import OrderStatus from './OrderStatus';
import PayloadTray, { PayloadPicker } from './PayloadTray';
import { addToBag, bagCount, bagFromBays, baysFromBag, bagTotal, coffeeDescription, emptyBays, linePrice, menuItem, money, payloadNames, randomDropOff, resizeBays, validBag } from './demo';
import type { Bag, BagLine, Bays, PayloadSize } from './demo';
import { placeOrder } from './api';
import { useCustomerOrders } from './useApi';

type Modal = 'bag' | 'bay' | 'maps' | 'about' | null;

const bayLabel = (bays: number) => `${bays} bay${bays === 1 ? '' : 's'}`;

export default function App() {
  const { orders, error: apiError, status: apiStatus, remember, receipts } = useCustomerOrders();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [bays, setBays] = useState<Bays>([]);
  const [payload, setPayload] = useState<PayloadSize | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [activeBay, setActiveBay] = useState(0);
  const [maps, setMaps] = useState<MapSettings | null>(null);
  const [mapClientId, setMapClientId] = useState('');
  const [mapToken, setMapToken] = useState('');
  const [mapError, setMapError] = useState('');
  const [route, setRoute] = useState(() => window.location.hash);
  const opener = useRef<HTMLElement | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const bag = bagFromBays(bays), count = bagCount(bag), capacity = payload ?? 0;
  const statusId = /^#\/order\/(FC-[A-Z0-9]+)$/.exec(route)?.[1];

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
  }
  function chooseFirst() {
    setModal(null);
    navigate('');
    window.setTimeout(() => {
      document.getElementById('payload')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      document.querySelector<HTMLButtonElement>('.payload-options button')?.focus({ preventScroll: true });
    }, 0);
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
    setBays(current => current.map((entry, i) => i === activeBay ? line : entry));
    setModal(null);
  }
  async function confirm() {
    if (!payload || !validBag(bag, payload) || submitting) return;
    setSubmitting(true); setSubmitError('');
    try {
      const receipt = await placeOrder(bag, payload, randomDropOff());
      remember(receipt);
      setBays(emptyBays(payload)); setModal(null);
      navigate(`#/order/${receipt.id}`);
    } catch (reason) {
      setSubmitError(`Order not confirmed: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally { setSubmitting(false); }
  }

  return <div className="app-shell">
    <div className="demo-strip"><span>AN ASPIRE SHOWCASE / FICTIONAL COFFEE. REAL POSSIBILITIES.</span><span className="strip-message">Melbourne made. Sky delivered.</span><button onClick={() => setModal('about')}>Inside the demo <ArrowRight size={12} /></button></div>
    <header className="site-header">
      <a href="#" className="wordmark" aria-label="ForthCoffee home" onClick={event => { event.preventDefault(); navigate(''); }}><span className="brand-symbol"><Coffee size={23} strokeWidth={1.6} /></span>Forth<span className="wordmark-light">Coffee</span><span className="brand-period">.</span></a>
      <div className="header-actions"><span className="location"><MapPin size={14} /> South Melbourne, VIC</span><button className="bag-button" onClick={() => setModal('bag')} aria-label={`Review payload, ${count} items`}><Package size={18} /><span className="bag-word">Your payload</span><span className="bag-count">{count}</span></button></div>
    </header>

    {apiError && <p className="form-error" role="alert">{apiError}</p>}
    {apiStatus && (!statusId || orders.some(order => order.id === statusId)) && <p className="small-print" role="status">{apiStatus}</p>}
    {statusId ? (orders.find(order => order.id === statusId) || !receipts.some(receipt => receipt.id === statusId)
      ? <OrderStatus order={orders.find(order => order.id === statusId)} orderId={statusId} settings={maps} onSettings={() => setModal('maps')} onBack={() => navigate('')} />
      : <main className="status-page"><p role="status">{apiError ? 'Order updates are unavailable. Your receipt is saved.' : 'Confirming your order…'}</p></main>)
      : <main>
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
      </main>}

    <footer><a className="footer-brand" href="#" onClick={event => { event.preventDefault(); navigate(''); }}>ForthCoffee.</a><span>Great coffee. A little altitude. Built with Aspire.</span><button onClick={() => setModal('about')}>A fictional company, by design <ArrowRight size={13} /></button><span className="footer-coordinates">SOUTH MELBOURNE · 37.83° S, 144.96° E</span></footer>
    {modal && <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setModal(null); }}><div className={`modal ${modal === 'bay' ? 'coffee-modal' : modal === 'bag' ? 'bag-modal' : ''}`} ref={dialog} role="dialog" aria-modal="true" aria-labelledby="modal-heading"><button className="modal-close icon-button" onClick={() => setModal(null)} aria-label="Close dialog"><X size={20} /></button>
      {modal === 'bay' && payload && <BaySelector key={activeBay} bay={activeBay} current={bays[activeBay] ?? null} onSave={fillBay} />}
      {modal === 'bag' && <><div className="eyebrow">03 / READY FOR TAKE-OFF?</div><h2 id="modal-heading">Your coffee run.</h2><p>ForthCoffee · South Melbourne · {payload ? `${payloadNames[payload]} payload` : 'No payload selected'}</p>
        {payload ? <><PayloadPicker value={payload} filled={count} onChange={choosePayload} /><p className="packing-hint">{bayLabel(capacity - count)} free. Smaller boxes unlock when their contents fit.</p></> : <button className="primary-button full-width" onClick={chooseFirst}>Choose your payload <ArrowRight size={15} /></button>}
        {!count ? <div className="empty-bag"><Coffee size={40} strokeWidth={1} /><h3>Your next good morning goes here.</h3><button className="outline-button" onClick={() => { setModal(null); navigate(''); window.setTimeout(() => document.getElementById('payload')?.scrollIntoView({ behavior: 'smooth' }), 0); }}>Fill a bay <ArrowRight size={15} /></button></div> : <><div className="bag-items">{bag.map(line => { const item = menuItem(line.itemId); return <div className="bag-item" key={line.id}><div className="bag-food">{line.coffee ? <CoffeeCup options={line.coffee} style={line.itemId} /> : <FoodArt kind={item.kind} />}</div><div><strong>{item.name}</strong>{line.coffee && <small>{coffeeDescription(line.coffee)}</small>}<small>{money(linePrice(line))} each · one bay each</small><div className="bag-line-actions"><div className="quantity-control"><button aria-label={`Remove one ${item.name}`} onClick={() => removeOne(line.id)}><Minus size={13} /></button><span>{line.quantity}</span><button aria-label={`Add one ${item.name}`} disabled={!payload || count >= capacity} onClick={() => { if (payload) setBag(addToBag(bag, { ...line, quantity: 1 }, payload)); }}><Plus size={13} /></button></div>{line.coffee && <button className="edit-coffee" onClick={() => openLine(line)}>Edit coffee</button>}</div></div><strong>{money(linePrice(line) * line.quantity)}</strong></div>; })}</div><div className="bag-summary"><div><span>Payload space</span><span>{count} of {bayLabel(capacity)} filled</span></div><div><span>Demo delivery</span><span>On us</span></div><div className="bag-total"><strong>Total (AUD)</strong><strong>{money(bagTotal(bag))}</strong></div></div>
          {submitError && <p className="form-error" role="alert">{submitError}</p>}
          <button className="primary-button full-width" disabled={submitting || !payload || !validBag(bag, payload)} onClick={() => void confirm()}>{submitting ? 'Confirming…' : 'Confirm demo order'} <ArrowRight size={16} /></button><button className="text-button full-width" onClick={() => setModal(null)}>Keep packing <Plus size={14} /></button><p className="privacy-note"><ShieldCheck size={14} />Fictional order. No payment, no real flight. Dietary suitability is not guaranteed.</p></>}
      </>}
      {modal === 'maps' && <><span className="dialog-symbol"><MapPin size={28} /></span><div className="eyebrow">A REAL PLACE. A FICTIONAL COFFEE BAR.</div><h2 id="modal-heading">A South Melbourne perspective.</h2><p>The illustrated map needs no credentials. Explore Azure Maps with your own existing account. Usage may incur charges; no resources are provisioned.</p><label className="field-label" htmlFor="client-id">Azure Maps account client ID (not an app registration ID)</label><input id="client-id" value={mapClientId} onChange={event => setMapClientId(event.target.value)} placeholder="Your Maps account client ID" /><label className="field-label" htmlFor="map-token">Short-lived Entra access token for Azure Maps</label><input id="map-token" type="password" autoComplete="off" value={mapToken} onChange={event => setMapToken(event.target.value)} placeholder="Token with Azure Maps Data Reader access" /><p className="small-print">Kept only in this page’s memory. Reloading clears it. Token refresh is not implemented. Never paste an account key.</p>{mapError && <p className="form-error" role="alert">{mapError}</p>}<button className="primary-button full-width" onClick={() => { if (!mapClientId.trim() || !mapToken.trim()) { setMapError('Both the account client ID and a short-lived access token are required.'); return; } setMaps({ clientId: mapClientId.trim(), token: mapToken.trim() }); setMapToken(''); setMapError(''); setModal(null); }}>Explore Azure Maps <ArrowRight size={16} /></button><button className="text-button full-width" onClick={() => { setMaps(null); setMapToken(''); setMapError(''); setModal(null); }}>Use the illustrated map instead</button></>}
      {modal === 'about' && <><span className="dialog-symbol"><Coffee size={28} /></span><div className="eyebrow">AN ASPIRE DESIGN SPIKE</div><h2 id="modal-heading">Good coffee. New possibilities.</h2><p>ForthCoffee is one fictional company exploring drone-delivered coffee in South Melbourne. No real company, shop, order or flight is represented.</p><div className="about-features"><span><Package size={18} />Choose a single, double or quad payload.</span><span><Coffee size={18} />Build each coffee and tuck in some treats.</span><span><Drone size={18} />Follow your order overhead and through a simulated camera.</span></div><p>Orders and drone telemetry come from the demo server. This browser saves your order receipts; the server resets on restart. Packaging is illustrative. No real payment or flight occurs.</p><button className="primary-button full-width" onClick={() => setModal(null)}>Back to your coffee run <ArrowLeft size={16} /></button></>}
    </div></div>}
  </div>;
}
