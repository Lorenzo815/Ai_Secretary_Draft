import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentCompanyId } from "@/lib/companies/context";
import { legacyCompanyId } from "@/lib/companies/ownership";

const mocks = vi.hoisted(() => ({ processMercadoPagoWebhook: vi.fn() }));

vi.mock("@/lib/payments/mercado-pago-webhook", () => ({
  processMercadoPagoWebhook: mocks.processMercadoPagoWebhook,
  WebhookError: class WebhookError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
  },
}));

import { POST } from "./route";

function notify(query = "") {
  return POST(new Request(`https://oria.test/api/webhooks/mercado-pago${query}`, {
    method: "POST",
    body: JSON.stringify({ data: { id: "123" } }),
    headers: { "x-signature": "ts=1,v1=abc", "x-request-id": "req" },
  }));
}

describe("Mercado Pago webhook company routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.processMercadoPagoWebhook.mockImplementation(async () => ({
      companyId: (await currentCompanyId()).toHexString(),
    }));
  });

  it("keeps the original clinic's registered URL working", async () => {
    const response = await notify();

    expect(await response.json()).toEqual({ companyId: legacyCompanyId().toHexString() });
    expect(mocks.processMercadoPagoWebhook).toHaveBeenCalledWith({ dataId: "123", signature: "ts=1,v1=abc", requestId: "req" });
  });

  it("processes another company's notification inside that company", async () => {
    const companyId = new ObjectId();

    const response = await notify(`?company=${companyId.toHexString()}`);

    expect(await response.json()).toEqual({ companyId: companyId.toHexString() });
  });

  it("acknowledges notifications of other topics without processing them", async () => {
    const response = await notify("?type=payment&data.id=123");

    expect(await response.json()).toEqual({ processed: false, ignored: "payment" });
    expect(mocks.processMercadoPagoWebhook).not.toHaveBeenCalled();
  });

  it("processes order notifications", async () => {
    await notify("?type=order&data.id=ORD01ABC");

    expect(mocks.processMercadoPagoWebhook).toHaveBeenCalledWith(expect.objectContaining({ dataId: "ORD01ABC" }));
  });

  it("rejects a malformed company before processing", async () => {
    const response = await notify("?company=not-a-company");

    expect(response.status).toBe(400);
    expect(mocks.processMercadoPagoWebhook).not.toHaveBeenCalled();
  });
});
