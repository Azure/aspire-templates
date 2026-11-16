import { useEffect, useState } from 'react';
import { SupportWidget } from './SupportWidget';
import { defaultBrand, fetchBrand } from './lib/types';
import type { Brand } from './lib/types';

const quickActions = [
  { title: 'Pay my bill', text: 'One-time payment or set up AutoPay in minutes.', icon: 'M4 7h16v10H4zM4 10h16M8 14h3' },
  { title: 'Report an outage', text: 'Let us know and get restoration updates by text.', icon: 'M13 3L5 13h6l-1 8 8-10h-6z' },
  { title: 'Start, stop or move', text: 'Moving home? Transfer your service in one step.', icon: 'M3 11l9-7 9 7M5 10v10h14V10' },
  { title: 'Track my usage', text: 'See daily usage and personalised savings tips.', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2' },
];

const plans = [
  { name: 'Essentials', price: '0.14', text: 'A simple fixed rate with no surprises.', features: ['12-month fixed rate', 'Paperless billing', 'Online account'] },
  { name: 'Green Choice', price: '0.16', text: '100% renewable energy for your home.', features: ['100% renewable', 'Usage insights', 'Smart thermostat rebate'], featured: true },
  { name: 'Time of Use', price: '0.09', text: 'Save by shifting usage to off-peak hours.', features: ['Off-peak savings', 'EV charging friendly', 'Hourly usage data'] },
];

export default function App() {
  const [brand, setBrand] = useState<Brand>(defaultBrand);

  useEffect(() => {
    void fetchBrand().then((value) => {
      setBrand(value);
      document.title = `${value.name} — ${value.tagline}`;
    });
  }, []);

  return (
    <div className="site">
      <div className="notice-bar">
        <span className="dot" aria-hidden="true" /> All systems normal in your area · <a href="#outages">View outage map</a>
      </div>

      <header className="site-header">
        <a className="wordmark" href="#top" aria-label={`${brand.name} home`}>
          {brand.name}
          <span>energy</span>
        </a>
        <nav aria-label="Main">
          <a href="#plans">Plans</a>
          <a href="#outages">Outages</a>
          <a href="#moving">Moving</a>
          <a href="#savings">Save energy</a>
        </nav>
        <a className="button button-ghost" href="#top">Sign in</a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Home energy</p>
            <h1>{brand.tagline}</h1>
            <p className="lede">
              Power your home with clean, affordable energy and get help from real people whenever you need it.
            </p>
            <div className="hero-actions">
              <a className="button button-primary" href="#plans">Compare plans</a>
              <a className="button button-light" href="#outages">Report an outage</a>
            </div>
          </div>
          <div className="hero-card" aria-hidden="true">
            <div className="usage-header">
              <span>This month</span>
              <strong>312 kWh</strong>
            </div>
            <div className="usage-bars">
              {[40, 62, 48, 75, 54, 68, 38, 58, 44, 70, 52, 35].map((h, i) => (
                <span key={i} style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="usage-footer">
              <span className="pill pill-good">▼ 12% vs last month</span>
              <span>Estimated bill $46.80</span>
            </div>
          </div>
        </section>

        <section className="quick-actions" aria-label="Quick actions">
          {quickActions.map((action) => (
            <a key={action.title} className="action-card" href="#top">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={action.icon} /></svg>
              <strong>{action.title}</strong>
              <span>{action.text}</span>
            </a>
          ))}
        </section>

        <section className="section" id="plans">
          <div className="section-heading">
            <p className="eyebrow">Plans</p>
            <h2>Find the right plan for your home</h2>
          </div>
          <div className="plans">
            {plans.map((plan) => (
              <article key={plan.name} className={`plan${plan.featured ? ' is-featured' : ''}`}>
                {plan.featured && <span className="plan-tag">Most popular</span>}
                <h3>{plan.name}</h3>
                <p>{plan.text}</p>
                <div className="price">${plan.price}<span>/kWh</span></div>
                <ul>
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <a className={`button ${plan.featured ? 'button-primary' : 'button-outline'}`} href="#top">Choose {plan.name}</a>
              </article>
            ))}
          </div>
        </section>

        <section className="section split" id="outages">
          <div>
            <p className="eyebrow">Outages</p>
            <h2>We're here when the lights go out</h2>
            <p>
              Crews are on call 24/7. Report an outage online or chat with our team and we'll keep you posted until
              your power is back.
            </p>
          </div>
          <div className="outage-card">
            <div><strong>0</strong><span>active outages near you</span></div>
            <div><strong>99.97%</strong><span>reliability this year</span></div>
            <div><strong>38 min</strong><span>average restoration</span></div>
          </div>
        </section>

        <section className="section cta" id="savings">
          <h2>Questions about your account?</h2>
          <p>Our support team is online now. Use the chat button in the corner to talk to a real person.</p>
        </section>
      </main>

      <footer className="site-footer" id="moving">
        <span>© {new Date().getFullYear()} {brand.legalName} · {brand.domain}</span>
        <span>Fictitious company for demonstration purposes only.</span>
      </footer>

      <SupportWidget brand={brand} />
    </div>
  );
}
