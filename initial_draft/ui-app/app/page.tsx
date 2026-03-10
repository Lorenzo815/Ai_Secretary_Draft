import { hero, highlights, kpis, pricingTiers, roadmap } from "@/lib/content";
import Link from "next/link";

export default function Home() {
  return (
    <main>
      <section className="section hero">
        <small>AI Secretary - Product Draft</small>
        <h1>{hero.title}</h1>
        <p>{hero.subtitle}</p>
        <div className="actions">
          <Link className="button primary" href="/proposta">
            {hero.ctaPrimary}
          </Link>
          <Link className="button secondary" href="/proposta/diferenciais">
            {hero.ctaSecondary}
          </Link>
        </div>
      </section>

      <section className="section">
        <h2>Practical Product Vision (Mockup)</h2>
        <p>
          Explore a clickable working draft of the logged app with MVP main pages: onboarding wizard,
          executive dashboard, inbox, flow builder, channels, costs, and billing.
        </p>
        <div className="actions">
          <Link className="button primary" href="/mockup">
            Open App Mockup
          </Link>
          <Link className="button secondary" href="/mockup/onboarding">
            Start Onboarding Path
          </Link>
        </div>
        <div className="grid cols-3">
          {[
            ["Dashboard", "/mockup"],
            ["Inbox", "/mockup/inbox"],
            ["Flow Builder", "/mockup/flow-builder"],
            ["Canais", "/mockup/canais"],
            ["Custos", "/mockup/custos"],
            ["Billing", "/mockup/billing"]
          ].map(([label, href]) => (
            <article key={label} className="card">
              <h3>{label}</h3>
              <Link className="pill" href={href}>
                Open {label}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Core Differentiators</h2>
        <div className="grid cols-2">
          {highlights.map((item) => (
            <article key={item.title} className="card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Pricing Snapshot</h2>
        <div className="grid cols-3">
          {pricingTiers.map((tier) => (
            <article key={tier.name} className="card">
              <h3>{tier.name}</h3>
              <p className="price">{tier.price}</p>
              <p>{tier.audience}</p>
              <ul>
                {tier.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Roadmap (12 Months)</h2>
        <div className="grid cols-2">
          {roadmap.map((phase) => (
            <article key={phase.quarter} className="card">
              <h4>
                {phase.quarter} - {phase.focus}
              </h4>
              <ul>
                {phase.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Business KPIs</h2>
        <div className="grid cols-2">
          {kpis.map((metric) => (
            <article key={metric.label} className="card">
              <h4>{metric.label}</h4>
              <p className="price">{metric.value}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
