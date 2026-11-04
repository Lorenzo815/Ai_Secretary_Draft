import "server-only";

import type { Collection, ObjectId } from "mongodb";
import clientPromise from "../mongodb";
import { scopedSettingsId, withCurrentCompany } from "../companies/context";
import { legacyCompanyId } from "../companies/ownership";
import { tenantDb } from "../companies/tenant-db";
import { DEFAULT_CONFIRMATION_TEMPLATE, validateConfirmationTemplateBody } from "./template-content";
import { confirmationScheduleIssues, describeConfirmationScheduleIssues } from "./timing";

const COLLECTION = "appointment_confirmation_config";

/** Agent Studio › Tarefas › Confirmação de consulta. */
export interface AppointmentConfirmationConfiguration {
  _id: string;
  revision: number;
  enabled: boolean;
  /** First reminder this many hours before the patient's first event of the day. */
  firstSendHoursBefore: number;
  /** Clinic-time window for reminders, [start, end). */
  activeStartHour: number;
  activeEndHour: number;
  maxAttempts: number;
  /** Between reminders, and the wait after the last one before the event becomes "Sem confirmação". */
  intervalMinutes: number;
  /** No reminders for bookings made less than this many hours before the first reminder time (0 = always send). */
  skipRecentHours: number;
  template: { name: string; language: string; body: string };
  updatedAt: Date;
  updatedBy: string;
}

export type ConfirmationSettingsInput = Omit<AppointmentConfirmationConfiguration, "_id" | "revision" | "updatedAt" | "updatedBy">;

export const DEFAULT_CONFIRMATION_SETTINGS: ConfirmationSettingsInput = {
  enabled: false,
  firstSendHoursBefore: 24,
  activeStartHour: 8,
  activeEndHour: 20,
  maxAttempts: 3,
  intervalMinutes: 120,
  skipRecentHours: 12,
  template: { ...DEFAULT_CONFIRMATION_TEMPLATE },
};

async function getCollection(): Promise<Collection<AppointmentConfirmationConfiguration>> {
  return (await tenantDb()).collection<AppointmentConfirmationConfiguration>(COLLECTION);
}

export async function getAppointmentConfirmationConfiguration(): Promise<AppointmentConfirmationConfiguration> {
  const id = await scopedSettingsId("active");
  const existing = await (await getCollection()).findOne({ _id: id });
  return existing ?? {
    _id: id, revision: 0, ...DEFAULT_CONFIRMATION_SETTINGS, template: { ...DEFAULT_CONFIRMATION_TEMPLATE },
    updatedAt: new Date(0), updatedBy: "system",
  };
}

export async function updateAppointmentConfirmationConfiguration(input: {
  expectedRevision: number;
  settings: ConfirmationSettingsInput;
  updatedBy: string;
  /** Activation requires the approved template; the caller checks it. */
  templateApproved: boolean;
}) {
  const settings = validateConfirmationSettings(input.settings);
  if (settings.enabled && !input.templateApproved) {
    throw new Error("Ative a confirmação depois que o modelo de confirmação for aprovado pela Meta.");
  }
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) throw new Error("Revisão inválida.");
  const id = await scopedSettingsId("active");
  const next: AppointmentConfirmationConfiguration = {
    _id: id, revision: input.expectedRevision + 1, ...settings, updatedAt: new Date(), updatedBy: input.updatedBy,
  };
  const collection = await getCollection();
  const stale = () => new Error("A configuração de confirmação foi alterada. Recarregue antes de salvar.");
  if (input.expectedRevision === 0) {
    const result = await collection.updateOne({ _id: id }, { $setOnInsert: await withCurrentCompany(next) }, { upsert: true });
    if (result.upsertedCount === 0) throw stale();
    return next;
  }
  const result = await collection.replaceOne({ _id: id, revision: input.expectedRevision }, await withCurrentCompany(next));
  if (result.matchedCount === 0) throw stale();
  return next;
}

export function validateConfirmationSettings(value: ConfirmationSettingsInput): ConfirmationSettingsInput {
  const integer = (input: unknown, min: number, max: number, message: string) => {
    if (!Number.isInteger(input) || (input as number) < min || (input as number) > max) throw new Error(message);
    return input as number;
  };
  const activeStartHour = integer(value.activeStartHour, 0, 23, "Início da janela inválido.");
  const activeEndHour = integer(value.activeEndHour, 1, 24, "Fim da janela inválido.");
  if (activeStartHour >= activeEndHour) throw new Error("A janela de envio deve começar antes de terminar.");
  const settings: ConfirmationSettingsInput = {
    enabled: value.enabled === true,
    firstSendHoursBefore: integer(value.firstSendHoursBefore, 2, 72, "O primeiro envio deve ser de 2 a 72 horas antes."),
    activeStartHour,
    activeEndHour,
    maxAttempts: integer(value.maxAttempts, 1, 3, "Use de 1 a 3 envios."),
    intervalMinutes: integer(value.intervalMinutes, 30, 720, "O intervalo deve ser de 30 minutos a 12 horas."),
    skipRecentHours: integer(value.skipRecentHours, 0, 48, "Use de 0 a 48 horas para agendamentos recentes."),
    template: {
      name: DEFAULT_CONFIRMATION_TEMPLATE.name,
      language: DEFAULT_CONFIRMATION_TEMPLATE.language,
      body: validateConfirmationTemplateBody(String(value.template?.body ?? "")),
    },
  };
  if (settings.enabled) {
    const [problem, ...others] = describeConfirmationScheduleIssues(confirmationScheduleIssues(settings), settings.maxAttempts);
    if (problem) {
      throw new Error(`Configuração impossível. ${problem}${others.length ? ` (e mais ${others.length} faixa(s) de horário)` : ""} Ajuste o primeiro envio, a janela, o número de envios ou o intervalo.`);
    }
  }
  return settings;
}

/** Clinics with the task enabled (the worker runs each one in its own company context). */
export async function listConfirmationEnabledCompanyIds(): Promise<ObjectId[]> {
  const documents = await (await clientPromise).db("ai_secretary")
    .collection<{ companyId?: ObjectId; enabled?: boolean }>(COLLECTION)
    .find({ enabled: true }, { projection: { companyId: 1 } })
    .toArray();
  return documents.map((document) => document.companyId ?? legacyCompanyId());
}
