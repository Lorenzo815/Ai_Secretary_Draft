import { PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { CLEANUP_TARGETS } from "@/lib/cleanup-rules";
import { listCompanyOverview } from "@/lib/companies";
import { CleanupClient } from "./cleanup-client";

export const metadata = { title: "Limpeza" };
export const dynamic = "force-dynamic";

export default async function CleanupPage() {
  await requireOwner();
  const companies = await listCompanyOverview();
  return (
    <>
      <PageHeader
        title="Limpeza de histórico"
        description="Remova manualmente dados antigos de registros técnicos para liberar espaço no MongoDB. Nada é excluído automaticamente. Pacientes, conversas, agendamentos, pagamentos, configurações e a auditoria nunca entram aqui, nem itens pendentes ou em uso."
      />
      <CleanupClient
        companies={companies.map((company) => ({ id: company.id, name: company.name, status: company.status }))}
        targets={Object.entries(CLEANUP_TARGETS).map(([key, target]) => ({ key, ...target }))}
      />
    </>
  );
}
