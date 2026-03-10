import { part3 } from "@/lib/content";

export default function ArchitecturePage() {
  return (
    <section className="section">
      <h2>Arquitetura Tecnica</h2>
      <div className="grid cols-2">
        {part3.architectureLayers.map((layer) => (
          <article key={layer.layer} className="card">
            <h3>{layer.layer}</h3>
            <p className="price">{layer.stack}</p>
            <p>{layer.notes}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
