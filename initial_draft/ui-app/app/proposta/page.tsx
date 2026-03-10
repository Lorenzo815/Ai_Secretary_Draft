import { part3 } from "@/lib/content";

export default function ProposalOverviewPage() {
  return (
    <section className="section">
      <h2>Platform Overview</h2>
      <p>{part3.mission}</p>
      <div className="grid cols-2">
        <article className="card">
          <h3>Vision</h3>
          <p>{part3.vision}</p>
        </article>
        <article className="card">
          <h3>Mission</h3>
          <p>{part3.mission}</p>
        </article>
      </div>
    </section>
  );
}
