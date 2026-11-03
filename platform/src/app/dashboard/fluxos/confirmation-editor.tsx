"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock3, LoaderCircle, RefreshCw, Send } from "lucide-react";

interface ConfirmationSettings {
  enabled: boolean;
  firstSendHoursBefore: number;
  activeStartHour: number;
  activeEndHour: number;
  maxAttempts: number;
  intervalMinutes: number;
  skipRecentHours: number;
  template: { name: string; language: string; body: string };
}

interface Payload {
  configuration: ConfirmationSettings & { revision: number; updatedBy: string };
  template: { state: "approved" | "pending" | "rejected" | "missing" | "invalid" | "paused" | "unavailable"; metaStatus: string | null; body: string | null; message: string };
  templateInfo: { name: string; language: string; defaultBody: string; buttons: string[]; help: string };
  unconfirmedUpcoming: number;
}

const inputClass = "mt-1.5 w-full rounded-lg border border-mist bg-white px-3 py-2 text-sm font-normal outline-none focus:border-deep-teal disabled:bg-pearl";
const buttonClass = "inline-flex items-center gap-1.5 rounded-lg border border-mist bg-white px-3 py-2 text-sm font-semibold text-slate-ink hover:border-deep-teal/50 disabled:opacity-45";
const INTERVALS: Array<[number, string]> = [[30, "30 min"], [60, "1 hora"], [120, "2 horas"], [180, "3 horas"], [240, "4 horas"], [360, "6 horas"]];

function editable(configuration: Payload["configuration"]): ConfirmationSettings {
  const { enabled, firstSendHoursBefore, activeStartHour, activeEndHour, maxAttempts, intervalMinutes, skipRecentHours, template } = configuration;
  return { enabled, firstSendHoursBefore, activeStartHour, activeEndHour, maxAttempts, intervalMinutes, skipRecentHours, template };
}

export default function ConfirmationEditor() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [value, setValue] = useState<ConfirmationSettings | null>(null);
  const [draftBody, setDraftBody] = useState("");
  const [busy, setBusy] = useState<"" | "save" | "submit" | "refresh">("");
  const [feedback, setFeedback] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/assistant/confirmation", { cache: "no-store" });
    const data = await response.json() as Payload & { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar a confirmação.");
    setPayload(data);
    setValue(editable(data.configuration));
    setDraftBody(data.template.body ?? data.configuration.template.body);
  }, []);

  useEffect(() => {
    load().catch((error) => setFeedback(error instanceof Error ? error.message : "Falha ao carregar."));
  }, [load]);

  if (!payload || !value) return <p className="flex items-center gap-2 py-10 text-sm text-stone"><LoaderCircle className="h-4 w-4 animate-spin" />{feedback || "Carregando..."}</p>;

  const approved = payload.template.state === "approved";
  const canSubmit = ["missing", "rejected"].includes(payload.template.state);
  const dirty = JSON.stringify(value) !== JSON.stringify(editable(payload.configuration));
  const set = (patch: Partial<ConfirmationSettings>) => setValue({ ...value, ...patch });

  async function run(kind: "save" | "submit" | "refresh") {
    setBusy(kind);
    setFeedback("");
    try {
      if (kind === "refresh") {
        await load();
        return;
      }
      const response = await fetch("/api/assistant/confirmation", kind === "save"
        ? { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: payload!.configuration.revision, configuration: { ...value, template: { ...value!.template, body: draftBody } } }) }
        : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: draftBody }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Não foi possível concluir.");
      await load();
      setFeedback(kind === "save" ? "Confirmação de consulta atualizada." : "Modelo enviado à Meta. A análise costuma levar de minutos a 24 horas.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Falha.");
    } finally {
      setBusy("");
    }
  }

  const hours = Array.from({ length: 25 }, (_, hour) => hour);
  const example = timelineExample(value);

  return <div className="space-y-7">
    {feedback && <p role="status" className="border-l-2 border-deep-teal bg-deep-teal/5 px-4 py-3 text-sm text-slate-ink">{feedback}</p>}

    {!approved && <section role="alert" className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
      <div className="text-sm leading-6 text-slate-ink">
        <p className="font-semibold">A confirmação precisa de um modelo aprovado pela Meta</p>
        <p className="mt-1 text-stone">{payload.templateInfo.help}</p>
        <p className="mt-1 font-medium">{payload.template.message}</p>
      </div>
    </section>}

    <label className="inline-flex cursor-pointer items-start gap-3">
      <input type="checkbox" checked={value.enabled} disabled={!approved && !value.enabled} onChange={(event) => set({ enabled: event.target.checked })} className="mt-1 h-4 w-4 accent-deep-teal" />
      <span><span className="block text-base font-semibold text-slate-ink">Confirmação de consulta</span><span className="mt-1 block text-xs font-normal text-stone">Envia o modelo aos pacientes com eventos “A confirmar” (uma mensagem por paciente por dia) e lê a resposta pelos botões.</span></span>
    </label>

    {payload.unconfirmedUpcoming > 0 && <p className="flex items-center gap-2 text-sm text-burnt-coral"><AlertTriangle className="h-4 w-4" />{payload.unconfirmedUpcoming} evento(s) futuro(s) sem confirmação. <Link href="/dashboard/calendario" className="font-semibold underline">Ver no calendário</Link></p>}

    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <label className="text-sm font-semibold text-slate-ink">Primeiro envio (horas antes do 1º evento do dia)
        <input type="number" min={2} max={72} value={value.firstSendHoursBefore} onChange={(event) => set({ firstSendHoursBefore: Number(event.target.value) })} className={inputClass} />
        <span className="mt-1 block text-[11px] font-normal text-stone">Ex.: 24, 48 ou 72. Sinal pago já dentro deste prazo deixa o evento “Confirmado” direto.</span>
      </label>
      <label className="text-sm font-semibold text-slate-ink">Janela de envio
        <span className="mt-1.5 flex items-center gap-2">
          <select value={value.activeStartHour} onChange={(event) => set({ activeStartHour: Number(event.target.value) })} className={inputClass.replace("mt-1.5 ", "")}>{hours.slice(0, 24).map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select>
          <span className="text-stone">até</span>
          <select value={value.activeEndHour} onChange={(event) => set({ activeEndHour: Number(event.target.value) })} className={inputClass.replace("mt-1.5 ", "")}>{hours.slice(1).map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>)}</select>
        </span>
        <span className="mt-1 block text-[11px] font-normal text-stone">Horário da clínica. Fora dele, o envio passa para o início da próxima janela.</span>
      </label>
      <label className="text-sm font-semibold text-slate-ink">Número de envios
        <select value={value.maxAttempts} onChange={(event) => set({ maxAttempts: Number(event.target.value) })} className={inputClass}>{[1, 2, 3].map((count) => <option key={count} value={count}>{count}</option>)}</select>
      </label>
      <label className="text-sm font-semibold text-slate-ink">Intervalo entre envios
        <select value={value.intervalMinutes} onChange={(event) => set({ intervalMinutes: Number(event.target.value) })} className={inputClass}>{INTERVALS.map(([minutes, label]) => <option key={minutes} value={minutes}>{label}</option>)}</select>
        <span className="mt-1 block text-[11px] font-normal text-stone">Também é a espera após o último envio antes de o evento ficar “Sem confirmação”.</span>
      </label>
      <label className="text-sm font-semibold text-slate-ink">Não lembrar agendamentos recentes (horas)
        <input type="number" min={0} max={48} value={value.skipRecentHours} onChange={(event) => set({ skipRecentHours: Number(event.target.value) })} className={inputClass} />
        <span className="mt-1 block text-[11px] font-normal text-stone">Sem lembretes se o agendamento foi feito há menos disso antes do 1º envio. Não vale para eventos com sinal pago. 0 = sempre enviar.</span>
      </label>
    </section>

    <section className="rounded-lg border border-mist bg-cloud/40 p-4 text-sm leading-6 text-stone">
      <p className="flex items-center gap-2 font-semibold text-slate-ink"><Clock3 className="h-4 w-4 text-deep-teal" />Como fica na prática</p>
      <p className="mt-1">{example}</p>
      <p className="mt-1">Botões: <strong className="text-slate-ink">{payload.templateInfo.buttons.join(" · ")}</strong>. “Confirmar” deixa os eventos do dia “Confirmado”; “Escolher novo horário” ativa a IA (mesmo em atendimento humano) e mantém o horário até o paciente escolher outro; “Cancelar” avisa a equipe — a IA nunca desmarca. Respostas depois de “Sem confirmação” também vão para a equipe.</p>
    </section>

    <section className="space-y-3 border-t border-mist pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-ink">Modelo de mensagem <code className="ml-1 text-[11px] font-normal text-stone">{payload.templateInfo.name} · {payload.templateInfo.language} · Utilidade</code></h3>
          <p className="mt-1 flex items-center gap-1.5 text-xs">{approved ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 text-amber-600" />}<span className={approved ? "text-emerald-700" : "text-amber-800"}>{payload.template.message}{payload.template.metaStatus ? ` (${payload.template.metaStatus})` : ""}</span></p>
        </div>
        <button type="button" onClick={() => void run("refresh")} disabled={Boolean(busy)} className={buttonClass}><RefreshCw className={`h-4 w-4 ${busy === "refresh" ? "animate-spin" : ""}`} />Atualizar status</button>
      </div>
      <label className="block text-sm font-semibold text-slate-ink">Texto
        <textarea rows={5} value={draftBody} disabled={!canSubmit} onChange={(event) => setDraftBody(event.target.value)} className={`${inputClass} font-mono text-xs leading-5`} />
        <span className="mt-1 block text-[11px] font-normal text-stone">{"{{1}}"} = primeiro nome · {"{{2}}"} = dia (ex.: sexta-feira, 06/11) · {"{{3}}"} = horários e eventos do dia. {canSubmit ? "Revise antes de enviar: depois de aprovado, o texto só muda com um novo modelo." : "Texto enviado à Meta (somente leitura)."}</span>
      </label>
      {canSubmit && <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void run("submit")} disabled={Boolean(busy)} className="inline-flex items-center gap-1.5 rounded-lg bg-deep-teal px-4 py-2 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-45"><Send className="h-4 w-4" />{busy === "submit" ? "Enviando..." : "Enviar modelo para aprovação"}</button>
        <button type="button" onClick={() => setDraftBody(payload.templateInfo.defaultBody)} className={buttonClass}>Restaurar texto padrão</button>
      </div>}
    </section>

    <footer className="flex items-center justify-between border-t border-mist pt-5">
      <p className="text-xs text-stone">{dirty ? "Alterações ainda não salvas" : `Atualizado por ${payload.configuration.updatedBy}`}</p>
      <button type="button" onClick={() => void run("save")} disabled={!dirty || Boolean(busy)} className="rounded-lg bg-deep-teal px-4 py-2.5 text-sm font-semibold text-white hover:bg-forest-teal disabled:opacity-45">{busy === "save" ? "Salvando..." : "Salvar confirmação"}</button>
    </footer>
  </div>;
}

/** Worked example with the current settings: an event at 10:00 (same rules as the server, without timezone). */
function timelineExample(value: ConfirmationSettings) {
  const appointment = new Date(2026, 0, 10, 10, 0);
  const intoWindow = (moment: Date) => {
    const result = new Date(moment);
    if (result.getHours() < value.activeStartHour) result.setHours(value.activeStartHour, 0, 0, 0);
    else if (result.getHours() >= value.activeEndHour) { result.setDate(result.getDate() + 1); result.setHours(value.activeStartHour, 0, 0, 0); }
    return result;
  };
  const sends: Date[] = [];
  let next: Date | null = intoWindow(new Date(appointment.getTime() - value.firstSendHoursBefore * 3_600_000));
  while (next && next < appointment && sends.length < value.maxAttempts) {
    sends.push(next);
    next = intoWindow(new Date(next.getTime() + value.intervalMinutes * 60_000));
  }
  const day = (moment: Date) => {
    const days = Math.round((new Date(appointment).setHours(0, 0, 0, 0) - new Date(moment).setHours(0, 0, 0, 0)) / 86_400_000);
    return days === 0 ? "no dia" : days === 1 ? "na véspera" : `${days} dias antes`;
  };
  const time = (moment: Date) => `${String(moment.getHours()).padStart(2, "0")}:${String(moment.getMinutes()).padStart(2, "0")}`;
  if (sends.length === 0) return "Com estas regras, nenhum envio caberia antes de uma consulta às 10:00.";
  const last = sends[sends.length - 1];
  const deadline = new Date(Math.min(last.getTime() + value.intervalMinutes * 60_000, appointment.getTime()));
  return `Consulta às 10:00: ${sends.map((moment) => `${day(moment)} às ${time(moment)}`).join(", ")}. Sem resposta, ${day(deadline)} às ${time(deadline)} o evento fica "Sem confirmação" e a equipe é alertada.`;
}
