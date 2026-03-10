import { part3 } from "@/lib/content";

export default function ResourcesPage() {
  return (
    <section className="section">
      <h2>Recursos Principais</h2>
      <div className="grid cols-2">
        {part3.resources.map((resource) => (
          <article key={resource.name} className="card">
            <h3>{resource.name}</h3>
            <ul>
              {resource.points.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </section>
  );
}
