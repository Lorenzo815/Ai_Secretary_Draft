import type { Metadata } from "next";
import MarketingHome from "./_components/marketing-home";

export const metadata: Metadata = {
  title: "Oria | Operação conversacional com IA",
  description: "Atendimento no WhatsApp, agenda, CRM e automação coordenados pelo AI Harness proprietário da Oria.",
};

export default function Home() {
  return <MarketingHome />;
}
