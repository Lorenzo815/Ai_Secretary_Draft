import type { Metadata } from "next";
import MarketingHome from "./_components/marketing-home";

export const metadata: Metadata = {
  title: "Oria | Transforme conversas em próximos passos",
  description: "A Oria entende mensagens no WhatsApp, organiza o atendimento e transforma pedidos em agendamentos, pagamentos e próximos passos.",
};

export default function Home() {
  return <MarketingHome />;
}
