import type { Metadata } from "next";
import MarketingHome from "./_components/marketing-home";

export const metadata: Metadata = {
  title: "Oria | Transforme conversas em próximos passos",
  description: "A Oria conecta WhatsApp, agenda, CRM e equipe para transformar cada conversa em uma ação segura para o seu negócio.",
};

export default function Home() {
  return <MarketingHome />;
}
