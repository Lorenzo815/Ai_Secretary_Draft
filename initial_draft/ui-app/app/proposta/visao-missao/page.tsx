import { part3 } from "@/lib/content";

export default function VisionMissionPage() {
  return (
    <section className="section">
      <h2>Visao e Missao</h2>
      <div className="grid cols-2">
        <article className="card">
          <h3>Visao</h3>
          <p>{part3.vision}</p>
        </article>
        <article className="card">
          <h3>Missao</h3>
          <p>{part3.mission}</p>
        </article>
      </div>
    </section>
  );
}
