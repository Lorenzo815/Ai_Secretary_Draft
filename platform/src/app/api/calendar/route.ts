import { getServerSession } from "next-auth";
import { DateTime } from "luxon";
import { NextRequest, NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import {
  bookManualAppointment,
  findAvailableSlots,
  getCalendarSettings,
  listAppointments,
  updateCalendarSettings,
  WeeklyAvailability,
  CalendarEventTypeDefinition,
  CalendarResourceDefinition,
} from "@/lib/calendar";
import { findCustomerById, listCustomers } from "@/lib/crm";

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
      const eventType = request.nextUrl.searchParams.get("eventType") ?? undefined;
      return NextResponse.json(await findAvailableSlots({ fromDate, toDate, eventType, limit: 30 }));
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
      const appointments = await listAppointments(from.toUTC().toJSDate(), to.toUTC().toJSDate());
      return NextResponse.json({ appointments });
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
  const [appointments, customers] = await Promise.all([
    listAppointments(from, to),
    listCustomers(),
  ]);
  return NextResponse.json({
    settings,
    appointments,
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
    weeklyAvailability?: WeeklyAvailability[];
    resources?: CalendarResourceDefinition[];
    eventTypes?: CalendarEventTypeDefinition[];
  };
  try {
    const settings = await updateCalendarSettings({
      providerName: input.providerName ?? "",
      timezone: input.timezone ?? "",
      slotDurationMinutes: Number(input.slotDurationMinutes),
      minimumNoticeHours: Number(input.minimumNoticeHours),
      weeklyAvailability: input.weeklyAvailability ?? [],
      resources: input.resources ?? [],
      eventTypes: input.eventTypes ?? [],
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
  const input = (await request.json()) as { customerId?: string; startAt?: string; eventType?: string; notes?: string };
  const customer = input.customerId ? await findCustomerById(input.customerId) : null;
  if (!input.startAt || !input.eventType) {
    return NextResponse.json({ error: "Tipo, data e hora são obrigatórios." }, { status: 400 });
  }
  if (input.customerId && !customer) {
    return NextResponse.json({ error: "Cliente inválido." }, { status: 400 });
  }
  const settings = await getCalendarSettings();
  if (input.eventType && !settings.eventTypes.some((eventType) => eventType.key === input.eventType)) {
    return NextResponse.json({ error: "Tipo de evento inválido." }, { status: 400 });
  }
  try {
    const appointment = await bookManualAppointment({
      customerId: customer?._id,
      customerName: customer?.name ?? "",
      contactPhone: customer?.phones[0] ?? "",
      startAt: input.startAt,
      eventType: input.eventType,
      notes: input.notes,
      source: "manual",
    });
    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao agendar." },
      { status: 409 },
    );
  }
}