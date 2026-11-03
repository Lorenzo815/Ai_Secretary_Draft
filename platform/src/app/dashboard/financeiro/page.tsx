import { canAccess } from "@/lib/access/contracts";
import { requirePrincipal } from "@/lib/access/server";
import { listCustomers } from "@/lib/crm";
import FinanceScreen from "./_components/finance-screen";

export const dynamic = "force-dynamic";

export default async function FinancePage() {
  const principal = await requirePrincipal();
  const customers = await listCustomers();
  return <FinanceScreen
    canManage={canAccess(principal, "finance", "manage")}
    customers={customers.map((customer) => ({
      id: customer._id.toHexString(),
      label: customer.phones[0] ? `${customer.name} · final ${customer.phones[0].slice(-4)}` : customer.name,
    })).sort((first, second) => first.label.localeCompare(second.label, "pt-BR"))}
  />;
}
