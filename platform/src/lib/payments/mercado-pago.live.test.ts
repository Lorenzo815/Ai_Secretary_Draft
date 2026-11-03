import { createHmac, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, describe, expect, it, vi } from "vitest";

// Live check against the real Mercado Pago API with a clinic's stored credentials. Never runs in CI.
//   MP_LIVE_TEST=1 MP_TEST_COMPANY_ID=<companyId> npx vitest run src/lib/payments/mercado-pago.live.test.ts
// With test credentials it creates a sandbox Pix order (payer "APRO", approved by Mercado Pago), waits for the
// approval and runs our webhook handler on a notification signed with the clinic's webhook secret.
// No database writes: saving the status and the post-payment actions are replaced by test doubles.
const live = process.env.MP_LIVE_TEST === "1";

const local = vi.hoisted(() => ({ requests: new Map<string, Record<string, unknown>>(), applied: vi.fn(), completed: vi.fn() }));
vi.mock("./payments", () => ({
  findPaymentRequestById: async (id: string) => local.requests.get(id) ?? null,
  applyProviderPaymentStatus: async (input: { paymentRequestId: ObjectId; status: string }) => {
    local.applied(input);
    return { ...local.requests.get(input.paymentRequestId.toHexString()), status: input.status };
  },
}));
vi.mock("./completion", () => ({ completePaymentTransition: async (...args: unknown[]) => { local.completed(...args); return {}; } }));

describe.skipIf(!live)("Mercado Pago (live, Orders API)", () => {
  const companyId = new ObjectId(process.env.MP_TEST_COMPANY_ID);
  let testAccount = false;

  async function inCompany<T>(operation: () => Promise<T>) {
    const { runWithCompany } = await import("../companies/context");
    return runWithCompany(companyId, operation);
  }

  afterAll(async () => {
    const { getMongoClient } = await import("../mongodb");
    await (await getMongoClient()).close();
  });

  it("uses the clinic's own stored credentials", async () => {
    const { getMercadoPagoCredential } = await import("./provider-credentials");
    const credential = await inCompany(() => getMercadoPagoCredential());
    expect(credential?.source).toBe("database");
    expect(credential?.webhookSecret.length).toBeGreaterThan(10);
  });

  it("is accepted by Mercado Pago", async () => {
    const { checkMercadoPagoAccount } = await import("./providers/mercado-pago");
    const account = await inCompany(() => checkMercadoPagoAccount());
    testAccount = account.testAccount;
    console.info(`account ${account.accountId} (${account.siteId}) ${testAccount ? "TEST" : "PRODUCTION"}`);
    expect(account.siteId).toBe("MLB");
  });

  it("creates a Pix order, gets it approved in sandbox, and our webhook marks it paid", async (context) => {
    if (!testAccount) context.skip(); // with production credentials this would create a real charge
    const { mercadoPagoProvider } = await import("./providers/mercado-pago");
    const { processMercadoPagoWebhook } = await import("./mercado-pago-webhook");
    const { getMercadoPagoCredential } = await import("./provider-credentials");

    const paymentRequestId = new ObjectId();
    const order = await inCompany(() => mercadoPagoProvider.createPayment({
      paymentRequestId, amountCents: 100, payerEmail: "test_payer@example.com", payerFirstName: "APRO", description: "Teste Oria",
    }));
    console.info(`order ${order.externalPaymentId}: ${order.status}, Pix code ${order.qrCode.length} chars`);
    expect(order.qrCode.length).toBeGreaterThan(50);
    local.requests.set(paymentRequestId.toHexString(), {
      _id: paymentRequestId, provider: "mercado_pago", externalPaymentId: order.externalPaymentId, amountCents: 100,
      status: "awaiting_provider_confirmation",
    });

    let status = order.status;
    for (let attempt = 0; attempt < 15 && status !== "processed"; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      status = (await inCompany(() => mercadoPagoProvider.getPayment(order.externalPaymentId))).status;
    }
    console.info(`order status after polling: ${status}`);
    expect(status).toBe("processed");

    // Same notification Mercado Pago sends, signed with the clinic's webhook secret.
    const credential = await inCompany(() => getMercadoPagoCredential());
    const requestId = randomUUID();
    const ts = String(Date.now());
    const v1 = createHmac("sha256", credential!.webhookSecret)
      .update(`id:${order.externalPaymentId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest("hex");
    const result = await inCompany(() => processMercadoPagoWebhook({
      dataId: order.externalPaymentId, signature: `ts=${ts},v1=${v1}`, requestId,
    }));

    expect(result).toMatchObject({ processed: true, status: "processed" });
    expect(local.applied).toHaveBeenCalledWith(expect.objectContaining({
      paymentRequestId, externalPaymentId: order.externalPaymentId, status: "paid",
    }));
    expect(local.completed).toHaveBeenCalledOnce();
  }, 90_000);
});
