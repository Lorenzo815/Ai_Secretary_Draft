import { ObjectId } from "mongodb";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppointmentDocument } from "@/lib/calendar";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  settings: vi.fn(),
  appointments: vi.fn(),
  accessEvents: vi.fn(),
  customers: vi.fn(),
  customerPage: vi.fn(),
  customer: vi.fn(),
  bookManual: vi.fn(),
}));

vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/calendar", () => ({
  getCalendarSettings: mocks.settings,
  listAppointments: mocks.appointments,
  listCalendarAccessEvents: mocks.accessEvents,
  bookManualAppointment: mocks.bookManual,
  bookManualAppointmentSeries: vi.fn(),
  findAvailableSlots: vi.fn(),
  updateCalendarSettings: vi.fn(),
}));
vi.mock("@/lib/crm", () => ({
  listCustomerOptions: mocks.customers,
  listCustomerOptionsPage: mocks.customerPage,
  findCustomerById: mocks.customer,
}));

import { GET, POST } from "./route";

const settings = {
  timezone: "America/Sao_Paulo",
  eventTypes: [{ key: "consultation" }],
};
const createdAt = new Date("2026-10-01T12:00:00Z");

function appointment(patch: Partial<AppointmentDocument> = {}): AppointmentDocument {
  return {
    _id: new ObjectId(),
    providerId: "doctor",
    customerName: "Stored name",
    contactPhone: "5511999999999",
    startAt: new Date("2026-10-28T15:00:00Z"),
    endAt: new Date("2026-10-28T15:30:00Z"),
    timezone: settings.timezone,
    status: "scheduled",
    eventType: "consultation",
    source: "assistant",
    createdAt,
    updatedAt: createdAt,
    ...patch,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { email: "staff@example.com" } });
  mocks.settings.mockResolvedValue(settings);
  mocks.appointments.mockResolvedValue([]);
  mocks.accessEvents.mockResolvedValue([]);
  mocks.customers.mockResolvedValue([]);
  mocks.customerPage.mockResolvedValue({ customers: [], page: 1, pageSize: 25, hasMore: false });
});

afterEach(() => vi.restoreAllMocks());

describe("calendar loading", () => {
  it.each(["configuration", "customers", "period", "week"])("requires authentication for %s", async (mode) => {
    mocks.session.mockResolvedValue(null);

    const response = await GET(new NextRequest(`http://localhost/api/calendar?mode=${mode}`));

    expect(response.status).toBe(401);
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.appointments).not.toHaveBeenCalled();
    expect(mocks.customers).not.toHaveBeenCalled();
    expect(mocks.customerPage).not.toHaveBeenCalled();
  });

  it("loads configuration without querying or returning appointments or the client directory", async () => {
    const accessEvents = [{ _id: new ObjectId(), title: "Permission" }];
    mocks.accessEvents.mockResolvedValue(accessEvents);

    const response = await GET(new NextRequest("http://localhost/api/calendar?mode=configuration"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      settings,
      accessEvents: [{ ...accessEvents[0], _id: accessEvents[0]._id.toHexString() }],
    });
    expect(mocks.appointments).not.toHaveBeenCalled();
    expect(mocks.customers).not.toHaveBeenCalled();
  });

  it("loads client options independently without fetching calendar data or exposing profiles", async () => {
    const customer = {
      _id: new ObjectId(),
      name: "CRM display name",
      phones: ["5511999999999"],
      createdAt,
      profile: { fullName: "Different full name", cpf: { encrypted: "private" } },
    };
    mocks.customerPage.mockResolvedValue({ customers: [customer], page: 1, pageSize: 25, hasMore: true });

    const response = await GET(new NextRequest("http://localhost/api/calendar?mode=customers"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      page: 1,
      pageSize: 25,
      hasMore: true,
      customers: [{
        id: customer._id.toHexString(),
        name: customer.name,
        phone: customer.phones[0],
        createdAt: createdAt.toISOString(),
      }],
    });
    expect(mocks.customerPage).toHaveBeenCalledExactlyOnceWith({ query: "", sort: "recent", page: 1 });
    expect(mocks.customers).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.appointments).not.toHaveBeenCalled();
    expect(mocks.accessEvents).not.toHaveBeenCalled();
  });

  it("passes search, sorting and pagination to the bounded client lookup", async () => {
    const response = await GET(new NextRequest("http://localhost/api/calendar?mode=customers&query=Maria&sort=alphabetical&page=3"));

    expect(response.status).toBe(200);
    expect(mocks.customerPage).toHaveBeenCalledExactlyOnceWith({ query: "Maria", sort: "alphabetical", page: 3 });
    expect(mocks.customers).not.toHaveBeenCalled();
  });

  it("rejects unsupported client sorting before any directory query", async () => {
    const response = await GET(new NextRequest("http://localhost/api/calendar?mode=customers&sort=invalid"));

    expect(response.status).toBe(400);
    expect(mocks.customerPage).not.toHaveBeenCalled();
  });

  it("returns client query validation errors explicitly", async () => {
    mocks.customerPage.mockRejectedValue(new RangeError("Informe uma página válida."));

    const response = await GET(new NextRequest("http://localhost/api/calendar?mode=customers&page=-1"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Informe uma página válida." });
  });

  it("reports directory outages without returning a successful empty page", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.customerPage.mockRejectedValue(new Error("Database unavailable"));

    const response = await GET(new NextRequest("http://localhost/api/calendar?mode=customers"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Não foi possível carregar os clientes." });
    expect(log).toHaveBeenCalledOnce();
  });

  it.each([
    ["period", "2026-10-01", "2026-10-31", "2026-10-01T03:00:00Z", "2026-11-01T03:00:00Z"],
    ["week", "2026-10-25", "2026-10-31", "2026-10-25T03:00:00Z", "2026-11-01T03:00:00Z"],
  ])("returns current CRM names for AI and manual events in %s with one targeted client query", async (mode, from, to, start, end) => {
    const customerId = new ObjectId();
    const anotherCustomerId = new ObjectId();
    mocks.appointments.mockResolvedValue([
      appointment({ customerId, customerName: "Old WhatsApp name" }),
      appointment({ customerId, customerName: "Old manual name", source: "manual" }),
      appointment({ customerId: anotherCustomerId, customerName: "Old second name" }),
    ]);
    mocks.customers.mockResolvedValue([
      { _id: customerId, name: "Current CRM name", profile: { fullName: "Not the display name" } },
      { _id: anotherCustomerId, name: "Second CRM name" },
    ]);

    const response = await GET(new NextRequest(`http://localhost/api/calendar?mode=${mode}&fromDate=${from}&toDate=${to}`));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.appointments.map((event: AppointmentDocument) => event.customerName))
      .toEqual(["Current CRM name", "Current CRM name", "Second CRM name"]);
    expect(mocks.customers).toHaveBeenCalledExactlyOnceWith([customerId, anotherCustomerId]);
    expect(mocks.appointments).toHaveBeenCalledExactlyOnceWith(new Date(start), new Date(end));
    expect(mocks.accessEvents).toHaveBeenCalledExactlyOnceWith(new Date(start), new Date(end));
    expect(Object.keys(data).sort()).toEqual(["accessEvents", "appointments"]);
  });

  it("keeps stored names for deleted clients and events without a linked client", async () => {
    const customerId = new ObjectId();
    mocks.appointments.mockResolvedValue([
      appointment({ customerId, customerName: "Deleted client" }),
      appointment({ customerName: "Unlinked event" }),
    ]);

    const response = await GET(new NextRequest("http://localhost/api/calendar?mode=period&fromDate=2026-10-01&toDate=2026-10-31"));
    const data = await response.json();

    expect(data.appointments.map((event: AppointmentDocument) => event.customerName))
      .toEqual(["Deleted client", "Unlinked event"]);
    expect(mocks.customers).toHaveBeenCalledExactlyOnceWith([customerId]);
  });

  it("skips the client lookup when there are no linked appointments", async () => {
    mocks.appointments.mockResolvedValue([appointment({ customerName: "Administrative event" })]);

    const response = await GET(new NextRequest("http://localhost/api/calendar?mode=period&fromDate=2026-10-01&toDate=2026-10-31"));

    expect(response.status).toBe(200);
    expect(mocks.customers).not.toHaveBeenCalled();
  });

  it("surfaces client lookup failures instead of returning stale names as a successful response", async () => {
    mocks.appointments.mockResolvedValue([appointment({ customerId: new ObjectId() })]);
    mocks.customers.mockRejectedValue(new Error("Client lookup unavailable"));

    const response = await GET(new NextRequest("http://localhost/api/calendar?mode=period&fromDate=2026-10-01&toDate=2026-10-31"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Client lookup unavailable" });
  });

  it.each([
    ["2026-10-31", "2026-10-01"],
    ["invalid", "2026-10-31"],
    ["2026-01-01", "2027-01-02"],
  ])("rejects invalid periods %s to %s before querying events or clients", async (from, to) => {
    const response = await GET(new NextRequest(`http://localhost/api/calendar?mode=period&fromDate=${from}&toDate=${to}`));

    expect(response.status).toBe(400);
    expect(mocks.appointments).not.toHaveBeenCalled();
    expect(mocks.customers).not.toHaveBeenCalled();
  });

  it("preserves the default response contract and reuses its client query to resolve names", async () => {
    const customerId = new ObjectId();
    mocks.appointments.mockResolvedValue([appointment({ customerId })]);
    mocks.customers.mockResolvedValue([{
      _id: customerId, name: "CRM display name", phones: [], createdAt,
    }]);

    const response = await GET(new NextRequest("http://localhost/api/calendar"));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(data).sort()).toEqual(["accessEvents", "appointments", "customers", "settings"]);
    expect(data.appointments[0].customerName).toBe("CRM display name");
    expect(data.customers[0].name).toBe("CRM display name");
    expect(mocks.customers).toHaveBeenCalledExactlyOnceWith();
  });
});

describe("manual appointment names", () => {
  it("saves the CRM display name rather than profile.fullName", async () => {
    const customerId = new ObjectId();
    mocks.customer.mockResolvedValue({
      _id: customerId, name: "CRM display name", phones: ["5511999999999"],
      profile: { fullName: "Different full name" },
    });
    mocks.bookManual.mockResolvedValue(appointment({ customerId, source: "manual" }));

    const response = await POST(new Request("http://localhost/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId: customerId.toHexString(), startAt: "2026-10-28T12:00", eventType: "consultation" }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.bookManual).toHaveBeenCalledWith(expect.objectContaining({
      customerId, customerName: "CRM display name", source: "manual",
    }));
  });
});
