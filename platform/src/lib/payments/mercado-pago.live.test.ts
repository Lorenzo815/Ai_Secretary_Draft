import { createHmac, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, describe, expect, it, vi } from "vitest";

// Live check against the real Mercado Pago API with a clinic's stored credentials. Never runs in CI.
//   MP_LIVE_TEST=1 MP_TEST_COMPANY_ID=<companyId> npx vitest run src/lib/payments/mercado-pago.live.test.ts
// Only with TEST credentials (sandbox): a Pix order is approved by Mercado Pago (payer "APRO") and our webhook
// handler processes a notification signed with the clinic's webhook secret; a payment link is created and read
// back. No database writes: request lookup, status changes, the ledger and post-payment actions are test doubles.
const live = process.env.MP_LIVE_TEST === "1";

const local = vi.hoisted(() => ({
  requests: new Map<string, Record<string, unknown>>(), applied: vi.fn(), completed: vi.fn(), ledger: vi.fn(),
}));
vi.mock("./payments", () => ({
  findPaymentRequestById: async (id: string) => local.requests.get(id) ?? null,
  applyProviderPaymentStatus: async (input: { paymentRequestId: ObjectId; status: string }) => {
    local.applied(input);
    return { ...local.requests.get(input.paymentRequestId.toHexString()), status: input.status };
  },
  markPaymentRefunded: vi.fn(),
}));
vi.mock("./completion", () => ({ completePaymentTransition: async (...args: unknown[]) => { local.completed(...args); return {}; } }));
vi.mock("./ledger", () => ({ recordMercadoPagoPayment: async (entry: unknown) => { local.ledger(entry); } }));

describe.skipIf(!live)("Mercado Pago (live sandbox)", () => {
  const companyId = new ObjectId(process.env.MP_TEST_COMPANY_ID);
  let testAccount = false;

  async function inCompany<T>(operation: () => Promise<T>) {
    const { runWithCompany } = await import("../companies/context");
    return runWithCompany(companyId, operation);
  }

  async function signedNotification(topic: "order" | "payment", dataId: string) {
    const { getMercadoPagoCredential } = await import("./provider-credentials");
    const { processMercadoPagoWebhook } = await import("./mercado-pago-webhook");
    const credential = await inCompany(() => getMercadoPagoCredential());
    const requestId = randomUUID();
    const ts = String(Date.now());
    const v1 = createHmac("sha256", credential!.webhookSecret).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex");
    return inCompany(() => processMercadoPagoWebhook({ topic, dataId, signature: `ts=${ts},v1=${v1}`, requestId }));
  }

  afterAll(async () => {
    const { getMongoClient } = await import("../mongodb");
    await (await getMongoClient()).close();
  });

  it("uses the clinic's own stored credentials, accepted by Mercado Pago", async () => {
    const { getMercadoPagoCredential } = await import("./provider-credentials");
    const { checkMercadoPagoAccount } = await import("./providers/mercado-pago");
    expect((await inCompany(() => getMercadoPagoCredential()))?.source).toBe("database");
    const account = await inCompany(() => checkMercadoPagoAccount());
    testAccount = account.testAccount;
    console.info(`account ${account.accountId} (${account.siteId}) ${testAccount ? "TEST" : "PRODUCTION"}`);
    expect(account.siteId).toBe("MLB");
  });

  it("Pix in the chat: order approved in sandbox, webhook records it in the ledger and marks the request paid", async (context) => {
    if (!testAccount) context.skip(); // with production credentials this would create a real charge
    const { createPixCharge, getOrder } = await import("./providers/mercado-pago");
    const paymentRequestId = new ObjectId();
    const pix = await inCompany(() => createPixCharge({
      paymentRequestId, amountCents: 100, payerEmail: "test_payer@example.com", payerFirstName: "APRO", description: "Teste Oria", expiryMinutes: 30,
    }));
    console.info(`order ${pix.orderId}: ${pix.status}, Pix code ${pix.qrCode.length} chars, expires ${pix.expiresAt?.toISOString()}`);
    expect(pix.qrCode.length).toBeGreaterThan(50);
    expect(pix.expiresAt!.getTime() - Date.now()).toBeGreaterThan(25 * 60_000);
    local.requests.set(paymentRequestId.toHexString(), {
      _id: paymentRequestId, customerId: new ObjectId(), provider: "mercado_pago", channel: "pix",
      externalPaymentId: pix.orderId, amountCents: 100, status: "awaiting_provider_confirmation",
    });

    let status = pix.status;
    for (let attempt = 0; attempt < 15 && status !== "processed"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      status = (await inCompany(() => getOrder(pix.orderId))).status;
    }
    expect(status).toBe("processed");

    const result = await signedNotification("order", pix.orderId);
    console.info(`webhook: ${JSON.stringify(result)}`);
    expect(result).toMatchObject({ processed: true, status: "processed" });
    expect(local.ledger).toHaveBeenCalledWith(expect.objectContaining({
      paymentRequestId, channel: "pix", payment: expect.objectContaining({ status: "approved", amountCents: 100, paymentMethod: "pix" }),
    }));
    expect(local.applied).toHaveBeenCalledWith(expect.objectContaining({ paymentRequestId, status: "paid" }));
    expect(local.completed).toHaveBeenCalledOnce();
  }, 90_000);

  it("payment link: created with the clinic's methods, installments, expiry and notification URL", async (context) => {
    if (!testAccount) context.skip();
    const { createPaymentLink } = await import("./providers/mercado-pago");
    const { getMercadoPagoCredential } = await import("./provider-credentials");
    const paymentRequestId = new ObjectId();
    const expiresAt = new Date(Date.now() + 24 * 3_600_000);
    const notificationUrl = `https://oria.example/api/webhooks/mercado-pago?company=${companyId.toHexString()}`;
    const link = await inCompany(() => createPaymentLink({
      paymentRequestId, amountCents: 100, payerEmail: "test_payer@example.com", description: "Sinal de atendimento",
      methods: ["credit_card", "debit_card", "ticket"], maxInstallments: 3, expiresAt, notificationUrl,
    }));
    console.info(`preference ${link.preferenceId}: ${new URL(link.url).host}${new URL(link.url).pathname}`);
    expect(link.url).toMatch(/^https:\/\/www\.mercadopago\.com\.br\//);

    const credential = await inCompany(() => getMercadoPagoCredential());
    const stored = await (await fetch(`https://api.mercadopago.com/checkout/preferences/${link.preferenceId}`, {
      headers: { Authorization: `Bearer ${credential!.accessToken}` },
    })).json() as {
      external_reference?: string; notification_url?: string; expires?: boolean;
      payment_methods?: { installments?: number; excluded_payment_types?: Array<{ id: string }> };
    };
    expect(stored).toMatchObject({ external_reference: paymentRequestId.toHexString(), notification_url: notificationUrl, expires: true });
    expect(stored.payment_methods?.installments).toBe(3);
    expect(stored.payment_methods?.excluded_payment_types?.map((type) => type.id)).toContain("bank_transfer");
  }, 30_000);
});
