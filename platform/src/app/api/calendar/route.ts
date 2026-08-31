import { getServerSession } from "next-auth";
import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  bookAppointment,
  findAvailableSlots,
  getCalendarSettings,
  listAppointments,
  listScheduledTriggers,
  updateCalendarSettings,
  WeeklyAvailability,
} from "@/lib/calendar";
import { findCustomerById, listCustomers } from "@/lib/crm";
import { listWhatsAppMessagesForAssistant } from "@/lib/whatsapp";

async function isAuthenticated() {
  return Boolean(await getServerSession(authOptions));
}

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const mode = request.nextUrl.searchParams.get("mode");
  if (mode === "slots") {
    try {
      const fromDate = request.nextUrl.searchParams.get("fromDate") ?? "";
      const toDate = request.nextUrl.searchParams.get("toDate") ?? fromDate;
      return NextResponse.json(await findAvailableSlots({ fromDate, toDate, limit: 30 }));
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Falha ao consultar horários." },
        { status: 400 },
      );
    }
  }

  const settings = await getCalendarSettings();
  if (mode === "week") {
    try {
      const fromDate = request.nextUrl.searchParams.get("fromDate") ?? "";
      const toDate = request.nextUrl.searchParams.get("toDate") ?? "";
      const from = DateTime.fromISO(fromDate, { zone: settings.timezone }).startOf("day");
      const to = DateTime.fromISO(toDate, { zone: settings.timezone }).plus({ days: 1 }).startOf("day");
      if (!from.isValid || !to.isValid || to.diff(from, "days").days !== 7) {
        return NextResponse.json({ error: "Informe uma semana válida de domingo a sábado." }, { status: 400 });
      }
      const [appointments, triggers] = await Promise.all([
        listAppointments(from.toUTC().toJSDate(), to.toUTC().toJSDate()),
        listScheduledTriggers(100, from.toUTC().toJSDate(), to.toUTC().toJSDate()),
      ]);
      return NextResponse.json({ appointments, triggers });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Falha ao carregar a semana." },
        { status: 400 },
      );
    }
  }
  const now = DateTime.now().setZone(settings.timezone);
  const from = now.startOf("day").toUTC().toJSDate();
  const to = now.plus({ days: 60 }).endOf("day").toUTC().toJSDate();
  const [appointments, customers, triggers] = await Promise.all([
    listAppointments(from, to),
    listCustomers(),
    listScheduledTriggers(),
  ]);
  return NextResponse.json({
    settings,
    appointments,
    triggers,
    customers: customers.map((customer) => ({
      id: customer._id.toString(),
      name: customer.name,
      phone: customer.phones[0] ?? "",
    })),
  });
}

export async function PUT(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const input = (await request.json()) as {
    providerName?: string;
    timezone?: string;
    slotDurationMinutes?: number;
    minimumNoticeHours?: number;
    followUpHoursBefore?: number;
    weeklyAvailability?: WeeklyAvailability[];
  };
  try {
    const settings = await updateCalendarSettings({
      providerName: input.providerName ?? "",
      timezone: input.timezone ?? "",
      slotDurationMinutes: Number(input.slotDurationMinutes),
      minimumNoticeHours: Number(input.minimumNoticeHours),
      followUpHoursBefore: Number(input.followUpHoursBefore),
      weeklyAvailability: input.weeklyAvailability ?? [],
    });
    return NextResponse.json({ settings });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao salvar agenda." },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const input = (await request.json()) as { customerId?: string; startAt?: string; notes?: string };
  const customer = input.customerId ? await findCustomerById(input.customerId) : null;
  if (!customer || !input.startAt) {
    return NextResponse.json({ error: "Cliente e horário são obrigatórios." }, { status: 400 });
  }
  try {
    const recentMessages = await listWhatsAppMessagesForAssistant(customer._id, undefined, 1);
    const appointment = await bookAppointment({
      customerId: customer._id,
      customerName: customer.name,
      contactPhone: customer.phones[0] ?? "",
      startAt: input.startAt,
      notes: input.notes,
      source: "manual",
      messageSource: recentMessages[0]?.source ?? "meta",
    });
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao agendar." },
      { status: 409 },
    );
  }
}