import { part3 } from "@/lib/content";

export default function ValuePropositionPage() {
  return (
    <section className="section">
      <h2>Proposta de Valor</h2>
      <div className="grid cols-3">
        {part3.valuePillars.map((pillar) => (
          <article key={pillar.segment} className="card">
            <h3>{pillar.segment}</h3>
            <p>{pillar.promise}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
