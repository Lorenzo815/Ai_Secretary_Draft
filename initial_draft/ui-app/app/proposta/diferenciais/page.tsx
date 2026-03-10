import { part3 } from "@/lib/content";

export default function DifferentiatorsPage() {
  return (
    <section className="section">
      <h2>Diferenciais Competitivos</h2>
      <div className="grid cols-2">
        {part3.differentiators.map((item) => (
          <article key={item.title} className="card">
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
