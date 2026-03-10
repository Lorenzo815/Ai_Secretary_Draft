import ProposalNav from "./_components/proposal-nav";

export default function ProposalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main>
      <section className="section hero">
        <small>PARTE 3</small>
        <h1>Proposta da Plataforma</h1>
        <p>
          Main product pages extracted from your business plan: vision, value proposition, differentiators,
          key capabilities, and target architecture.
        </p>
      </section>
      <ProposalNav />
      {children}
    </main>
  );
}
