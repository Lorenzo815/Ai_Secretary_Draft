import "server-only";

import { DateTime } from "luxon";
import { ObjectId } from "mongodb";
import {
  attachPaymentToAppointments, detachPaymentFromAppointments, findAppointmentsByIds, getCalendarSettings,
  listAllocatableAppointments, type AppointmentDocument,
} from "../calendar";
import { tenantDb } from "../companies/tenant-db";
import { applyAttendanceAfterPayment } from "../confirmations/service";
import { listTransactionsForRequests, recordManualEntryRemoval } from "./ledger";
import { MANUAL_METHOD_LABELS, MANUAL_PAYMENT_METHODS, type ManualPaymentMethod } from "./manual-methods";
import {
  createManualPaymentEntry, deleteManualPaymentEntry, getPaymentRequest, listPaymentRequests, setPaymentAppointments,
  unlinkAppointmentsFromOtherPayments, type PaymentRequestDocument,
} from "./payments";

export interface FinanceFilter {
  view: "processed" | "all";
  from?: string;
  to?: string;
  customerId?: string;
  source?: "mercado_pago" | "manual";
}

export interface FinanceAppointment {
  id: string;
  eventTypeName: string;
  startAt: string;
  status: AppointmentDocument["status"];
  confirmationStatus: "pending" | "confirmed" | "unconfirmed" | null;
  holdExpiresAt: string | null;
}

export interface FinancePayment {
  id: string;
  customerId: string;
  customerName: string;
  amountCents: number;
  status: PaymentRequestDocument["status"];
  refunded: boolean;
  refundStatus: string | null;
  source: "mercado_pago" | "manual";
  /** How it was charged or received, in words. */
  methodLabel: string;
  planKey: string | null;
  createdAt: string;
  paidAt: string | null;
  expiresAt: string | null;
  feeCents: number | null;
  netCents: number | null;
  note: string | null;
  reviewedBy: string | null;
  /** Registered by staff in Financeiro (ledger channel manual_entry): can be removed. */
  manualEntry: boolean;
  appointments: FinanceAppointment[];
}

export async function listFinance(filter: FinanceFilter) {
  const settings = await getCalendarSettings();
  const zone = settings.timezone;
  const from = filter.from ? DateTime.fromISO(filter.from, { zone }).startOf("day") : null;
  const to = filter.to ? DateTime.fromISO(filter.to, { zone }).endOf("day") : null;
  if ((from && !from.isValid) || (to && !to.isValid)) throw new FinanceError("Período inválido.");
  if (filter.customerId && !ObjectId.isValid(filter.customerId)) throw new FinanceError("Paciente inválido.");

  const requests = await listPaymentRequests({
    view: filter.view,
    ...(from ? { from: from.toJSDate() } : {}),
    ...(to ? { to: to.toJSDate() } : {}),
    ...(filter.customerId ? { customerId: new ObjectId(filter.customerId) } : {}),
    ...(filter.source ? { provider: filter.source } : {}),
  });
  const payments = await serializePayments(requests, settings.eventTypes);
  const settled = payments.filter((payment) => payment.status === "paid" && !payment.refunded);
  const receivedCents = sum(settled.map((payment) => payment.amountCents));
  const feesCents = sum(settled.map((payment) => payment.feeCents ?? 0));
  return {
    timezone: zone,
    payments,
    totals: {
      count: settled.length,
      receivedCents,
      feesCents,
      netCents: receivedCents - feesCents,
      refundedCents: sum(payments.filter((payment) => payment.refunded).map((payment) => payment.amountCents)),
      unallocatedCount: settled.filter((payment) => payment.appointments.length === 0).length,
    },
  };
}

export async function listPatientPayments(customerId: ObjectId, requests: PaymentRequestDocument[]) {
  const settings = await getCalendarSettings();
  return serializePayments(requests.filter((request) => request.customerId.equals(customerId)), settings.eventTypes);
}

/** Appointments of the patient a payment can cover, for the allocation editor. */
export async function listAllocatableAppointmentsForCustomer(customerId: ObjectId) {
  const [settings, appointments] = await Promise.all([getCalendarSettings(), listAllocatableAppointments(customerId)]);
  return appointments.map((appointment) => serializeAppointment(appointment, settings.eventTypes));
}

/**
 * Sets which appointments a paid payment covers. Linking a held appointment confirms it (it becomes
 * "A confirmar", like a deposit paid through the chat); unlinking only removes the payment reference.
 */
export async function allocatePayment(input: { paymentRequestId: ObjectId; appointmentIds: ObjectId[] }) {
  const payment = await getPaymentRequest(input.paymentRequestId);
  if (!payment) throw new FinanceError("Pagamento não encontrado.", 404);
  if (payment.status !== "paid") throw new FinanceError("Só pagamentos recebidos podem ser vinculados a agendamentos.");
  const wanted = uniqueIds(input.appointmentIds);
  const linked = await assertAllocatable(payment.customerId, wanted);
  const current = payment.appointmentIds ?? [];
  const removed = current.filter((id) => !wanted.some((other) => other.equals(id)));
  if (removed.length > 0) await detachPaymentFromAppointments(payment._id, removed);
  await unlinkAppointmentsFromOtherPayments(wanted, payment._id);
  await attachPaymentToAppointments({
    customerId: payment.customerId,
    appointmentIds: wanted,
    paymentRequestId: payment._id,
    paidAt: payment.paidAt ?? payment.reviewedAt ?? payment.updatedAt,
  });
  await applyAttendanceAfterPayment({ customerId: payment.customerId, appointments: linked.filter((appointment) => appointment.status === "held") });
  return setPaymentAppointments(payment._id, wanted);
}

export async function registerManualPayment(input: {
  customerId: ObjectId;
  amountCents: number;
  method: string;
  receivedAt: Date;
  note?: string;
  appointmentIds: ObjectId[];
  createdBy: string;
}) {
  if (!MANUAL_PAYMENT_METHODS.includes(input.method as ManualPaymentMethod)) throw new FinanceError("Forma de pagamento inválida.");
  const customer = await (await tenantDb()).collection("crm_customers").findOne({ _id: input.customerId }, { projection: { _id: 1 } });
  if (!customer) throw new FinanceError("Paciente não encontrado.", 404);
  const appointmentIds = uniqueIds(input.appointmentIds);
  const linked = await assertAllocatable(input.customerId, appointmentIds);
  const payment = await createManualPaymentEntry({ ...input, method: input.method as ManualPaymentMethod, appointmentIds });
  await unlinkAppointmentsFromOtherPayments(appointmentIds, payment._id);
  await attachPaymentToAppointments({
    customerId: input.customerId, appointmentIds, paymentRequestId: payment._id, paidAt: input.receivedAt,
  });
  await applyAttendanceAfterPayment({ customerId: input.customerId, appointments: linked.filter((appointment) => appointment.status === "held") });
  return payment;
}

/**
 * Removes a payment registered by staff (e.g. typed by mistake). Its appointments stay booked and only lose
 * the payment reference; the ledger keeps the original row and gets a "voided" row.
 */
export async function removeManualPayment(input: { paymentRequestId: ObjectId; removedBy: string; reason?: string }) {
  const payment = await getPaymentRequest(input.paymentRequestId);
  if (!payment) throw new FinanceError("Pagamento não encontrado.", 404);
  if (!payment.manualMethod) {
    throw new FinanceError("Só pagamentos registrados manualmente no Financeiro podem ser removidos.");
  }
  await detachPaymentFromAppointments(payment._id);
  const deleted = await deleteManualPaymentEntry(payment._id);
  if (!deleted) throw new FinanceError("Pagamento não encontrado.", 404);
  await recordManualEntryRemoval({
    paymentRequestId: payment._id,
    customerId: payment.customerId,
    amountCents: payment.amountCents,
    method: payment.manualMethod,
    removedBy: input.removedBy,
    reason: input.reason,
  });
}

async function assertAllocatable(customerId: ObjectId, appointmentIds: ObjectId[]) {
  if (appointmentIds.length > 50) throw new FinanceError("Selecione no máximo 50 agendamentos.");
  const appointments = await findAppointmentsByIds(appointmentIds);
  const now = Date.now();
  const valid = appointments.filter((appointment) => (
    appointment.customerId?.equals(customerId) &&
    (appointment.status === "scheduled" || appointment.status === "completed" ||
      (appointment.status === "held" && (appointment.holdExpiresAt?.getTime() ?? 0) > now))
  ));
  if (valid.length !== appointmentIds.length) {
    throw new FinanceError("Algum agendamento não é deste paciente, foi cancelado ou a reserva expirou.");
  }
  return valid;
}

async function serializePayments(
  requests: PaymentRequestDocument[],
  eventTypes: Array<{ key: string; name: string }>,
): Promise<FinancePayment[]> {
  const customerIds = uniqueIds(requests.map((request) => request.customerId));
  const appointmentIds = uniqueIds(requests.flatMap((request) => request.appointmentIds ?? []));
  const [customers, appointments, transactions] = await Promise.all([
    customerIds.length === 0 ? [] : (await tenantDb()).collection<{ _id: ObjectId; name?: string; phones?: string[] }>("crm_customers")
      .find({ _id: { $in: customerIds } }, { projection: { name: 1, phones: 1 } }).toArray(),
    findAppointmentsByIds(appointmentIds),
    listTransactionsForRequests(requests.map((request) => request._id)),
  ]);
  const customerNames = new Map(customers.map((customer) => [customer._id.toHexString(), customer.name || customer.phones?.[0] || "Paciente"]));
  const appointmentsById = new Map(appointments.map((appointment) => [appointment._id.toHexString(), appointment]));
  return requests.map((request) => {
    const rows = transactions.get(request._id.toHexString()) ?? [];
    const settlement = rows.find((row) => row.status === "approved" && (!request.providerPaymentId || row.providerPaymentId === request.providerPaymentId));
    const feeCents = settlement?.feeCents ?? null;
    return {
      id: request._id.toHexString(),
      customerId: request.customerId.toHexString(),
      customerName: customerNames.get(request.customerId.toHexString()) ?? "Paciente removido",
      amountCents: request.amountCents,
      status: request.status,
      refunded: Boolean(request.refundedAt),
      refundStatus: request.refundStatus ?? null,
      source: request.provider ?? "manual",
      methodLabel: methodLabel(request, settlement?.paymentMethod === "pix" ? "pix" : settlement?.paymentType),
      planKey: request.planKey ?? null,
      createdAt: request.createdAt.toISOString(),
      paidAt: request.paidAt?.toISOString() ?? (request.status === "paid" ? request.reviewedAt?.toISOString() ?? null : null),
      expiresAt: request.expiresAt?.toISOString() ?? null,
      feeCents,
      netCents: feeCents === null ? null : request.amountCents - feeCents,
      note: request.reviewNote ?? null,
      reviewedBy: request.reviewedBy ?? request.createdBy ?? null,
      manualEntry: Boolean(request.manualMethod),
      appointments: (request.appointmentIds ?? []).flatMap((id) => {
        const appointment = appointmentsById.get(id.toHexString());
        return appointment ? [serializeAppointment(appointment, eventTypes)] : [];
      }),
    };
  });
}

function serializeAppointment(appointment: AppointmentDocument, eventTypes: Array<{ key: string; name: string }>): FinanceAppointment {
  return {
    id: appointment._id.toHexString(),
    eventTypeName: appointment.customTitle || eventTypes.find((eventType) => eventType.key === appointment.eventType)?.name || appointment.eventType,
    startAt: appointment.startAt.toISOString(),
    status: appointment.status,
    confirmationStatus: appointment.confirmationStatus ?? null,
    holdExpiresAt: appointment.holdExpiresAt?.toISOString() ?? null,
  };
}

const PROVIDER_METHOD_LABELS: Record<string, string> = {
  pix: "Pix", credit_card: "Cartão de crédito", debit_card: "Cartão de débito", ticket: "Boleto", bank_transfer: "Transferência",
};

function methodLabel(request: PaymentRequestDocument, providerMethod?: string) {
  if (request.manualMethod) return MANUAL_METHOD_LABELS[request.manualMethod];
  if (request.provider !== "mercado_pago") return "Pix (chave da clínica, conferido pela equipe)";
  const paidWith = providerMethod ? PROVIDER_METHOD_LABELS[providerMethod] ?? providerMethod : null;
  if (request.channel === "payment_link") return `Link Mercado Pago${paidWith ? ` · ${paidWith}` : ""}`;
  return "Pix Mercado Pago";
}

function uniqueIds(ids: ObjectId[]) {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const key = id.toHexString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export class FinanceError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
