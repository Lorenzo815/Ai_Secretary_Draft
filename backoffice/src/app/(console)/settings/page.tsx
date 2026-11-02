import { Card, PageHeader } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { getDb } from "@/lib/mongodb";
import { getGatewayKeyInfo } from "@/lib/oria-settings";
import { GatewayKeyPanel } from "./gateway-key-panel";

export const metadata = { title: "Oria" };

export default async function OriaSettingsPage() {
  const [key, models, names] = await Promise.all([
    getGatewayKeyInfo(),
    getDb().then((db) => db.collection("ai_model_config").find({}, { projection: { companyId: 1, activeProvider: 1, tasks: 1 } }).toArray()),
    getDb().then((db) => db.collection("companies").find({}, { projection: { name: 1 } }).toArray()),
  ]);
  const companyName = new Map(names.map((company) => [String(company._id), String(company.name)]));

  return (
    <>
      <PageHeader title="Oria" description="Configurações compartilhadas por todas as clínicas." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Vercel AI Gateway" description="Chave única da Oria: todas as clínicas consomem os créditos da conta Vercel dona desta chave.">
          {!key.configured ? <p className="text-sm text-slate-ink/60">Nenhuma chave configurada: a IA não funciona em nenhuma clínica.</p>
            : "error" in key ? <p className="text-sm text-red-700">{key.error}</p> : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                <dt className="text-slate-ink/55">Chave</dt><dd className="font-mono">{key.masked} <span className="text-xs text-slate-ink/45">({key.length} caracteres)</span></dd>
                <dt className="text-slate-ink/55">Salva em</dt><dd>{formatDate(key.updatedAt)}</dd>
                <dt className="text-slate-ink/55">Por</dt><dd>{key.updatedBy || "—"}</dd>
              </dl>
            )}
          <GatewayKeyPanel configured={key.configured && !("error" in key)} />
        </Card>

        <Card title="Modelos por clínica" description="Cada clínica escolhe o modelo na página da clínica; a cobrança é sempre pela chave acima.">
          <ul className="divide-y divide-mist text-sm">
            {models.map((model) => (
              <li key={String(model._id)} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-semibold">{companyName.get(String(model.companyId)) ?? String(model._id)}</span>
                <span className="font-mono text-xs text-slate-ink/70">
                  {model.activeProvider} · {model.tasks?.customer_agent?.vercelModel ?? "—"} ({model.tasks?.customer_agent?.reasoningEffort ?? "default"})
                </span>
              </li>
            ))}
            {models.length === 0 && <li className="py-2 text-slate-ink/50">Nenhuma configuração ainda.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
