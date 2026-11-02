import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Database } from "lucide-react";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { getCompanyDetail, listCompanyOverview } from "@/lib/companies";
import { formatDate, formatNumber } from "@/lib/format";
import { LEGACY_COMPANY_ID } from "@/lib/platform-rules";
import { AiSection, DangerZone, ProfileSection, UsersSection, WhatsAppSection } from "./company-sections";

export default async function CompanyPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[a-f0-9]{24}$/i.test(id)) notFound();
  const [detail, all] = await Promise.all([getCompanyDetail(id).catch(() => null), listCompanyOverview()]);
  if (!detail) notFound();
  const { company } = detail;
  const legacy = id === LEGACY_COMPANY_ID;

  const users = detail.users.map((user) => ({
    id: user._id.toHexString(), name: user.name, email: user.email, disabled: user.disabled === true,
    permissions: user.permissions, isAdmin: Boolean(company.adminUserId?.equals(user._id)), createdAt: user.createdAt?.toISOString() ?? "",
  }));
  const connections = detail.connections.map((connection) => ({
    id: String(connection._id), status: connection.status, wabaId: connection.wabaId ?? "", phoneNumberId: connection.phoneNumberId ?? "",
    displayPhoneNumber: connection.displayPhoneNumber ?? "", label: connection.label ?? "", graphVersion: connection.graphVersion ?? "",
    updatedAt: connection.updatedAt instanceof Date ? connection.updatedAt.toISOString() : "",
  }));

  return (
    <>
      <Link href="/companies" className="mb-3 inline-flex items-center gap-1 text-sm font-semibold text-slate-ink/60 hover:text-deep-teal"><ArrowLeft className="h-4 w-4" />Clínicas</Link>
      <PageHeader
        title={company.name}
        description={<span className="inline-flex flex-wrap items-center gap-2"><StatusBadge status={company.status} isolationReady={company.isolationReady} legacy={legacy} /><span className="font-mono text-xs">{id}</span><span className="text-xs">criada em {formatDate(company.createdAt)}</span></span>}
      />
      {created && (
        <div className="mb-6 rounded-xl border border-soft-jade/60 bg-soft-jade/15 px-4 py-3 text-sm text-forest-teal">
          Clínica criada. Para a equipe entrar, a clínica precisa estar <strong>Liberada</strong> e a plataforma com <code>TENANT_STRICT=true</code>.
          Depois conecte o número de WhatsApp (pela tela de Sistema da plataforma ou aqui) e revise a IA.
        </div>
      )}
      {company.status === "active" && (
        <div className="mb-6 rounded-xl border border-night/20 bg-night px-4 py-3 text-sm text-white">
          Clínica em produção (status Ativa). Toda alteração pede confirmação digitando <code className="rounded bg-white/15 px-1">PRODUCAO</code>.
          {legacy && " Esta é a clínica original: usa o número de WhatsApp e as chaves do Mercado Pago do ambiente."}
        </div>
      )}

      <div className="grid gap-6 2xl:grid-cols-2">
        <ProfileSection companyId={id} company={{
          name: company.name, legalName: company.legalName ?? "", cnpj: company.cnpj ?? "", contactEmail: company.contactEmail ?? "",
          contactPhone: company.contactPhone ?? "", status: company.status, isolationReady: company.isolationReady === true,
        }} legacy={legacy} />
        <WhatsAppSection companyId={id} connections={connections} legacy={legacy} />
        <UsersSection companyId={id} users={users} className="2xl:col-span-2" />
        <AiSection companyId={id} json={detail.aiConfigJson} revision={Number(detail.aiConfig?.revision ?? 0)}
          updatedBy={String(detail.aiConfig?.updatedBy ?? "")} others={all.filter((other) => other.id !== id).map((other) => ({ id: other.id, name: other.name }))} />
        <Card title="Dados desta clínica" description="Abra qualquer coleção já filtrada por esta clínica.">
          {detail.counts.length === 0 ? <p className="text-sm text-slate-ink/50">Ainda não há dados.</p> : (
            <ul className="grid gap-1 sm:grid-cols-2">
              {detail.counts.map((entry) => (
                <li key={entry.name}>
                  <Link href={`/data/${entry.name}?company=${id}`} className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-soft-ivory">
                    <span className="inline-flex items-center gap-2 font-mono text-xs text-slate-ink"><Database className="h-3.5 w-3.5 text-deep-teal" />{entry.name}</span>
                    <span className="tabular-nums text-slate-ink/60">{formatNumber(entry.count)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        {!legacy && <DangerZone companyId={id} name={company.name} live={company.status === "active"} className="2xl:col-span-2" />}
      </div>
    </>
  );
}
