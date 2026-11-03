import { ObjectId } from "mongodb";
import { afterAll, describe, expect, it } from "vitest";

// Live test against the real Mercado Pago API with a clinic's stored credential. Never runs in CI.
//   MP_LIVE_TEST=1 MP_TEST_COMPANY_ID=<companyId> MP_TEST_PAYER_EMAIL=<payer> npx vitest run src/lib/payments/mercado-pago.live.test.ts
// It reads the credential and creates a R$ 1,00 Pix charge, then cancels it. Nothing is written to the database.
const live = process.env.MP_LIVE_TEST === "1";
const created: string[] = [];

describe.skipIf(!live)("Mercado Pago (live)", () => {
  const companyId = new ObjectId(process.env.MP_TEST_COMPANY_ID);
  const payerEmail = process.env.MP_TEST_PAYER_EMAIL ?? "";

  async function inCompany<T>(operation: () => Promise<T>) {
    const { runWithCompany } = await import("../companies/context");
    return runWithCompany(companyId, operation);
  }

  afterAll(async () => {
    const { getMercadoPagoCredential } = await import("./provider-credentials");
    const credential = await inCompany(() => getMercadoPagoCredential());
    for (const id of created) {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${credential!.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      console.info(`cancel ${id}: HTTP ${response.status}`);
    }
    const { getMongoClient } = await import("../mongodb");
    await (await getMongoClient()).close();
  });

  it("reads the clinic's own credential (not the environment's)", async () => {
    const { getMercadoPagoCredential } = await import("./provider-credentials");
    const credential = await inCompany(() => getMercadoPagoCredential());
    expect(credential?.source).toBe("database");
    console.info(`token type: ${credential!.accessToken.startsWith("APP_USR-") ? "APP_USR" : credential!.accessToken.slice(0, 5)}`);
  });

  it("is accepted by Mercado Pago", async () => {
    const { checkMercadoPagoAccount } = await import("./providers/mercado-pago");
    const account = await inCompany(() => checkMercadoPagoAccount());
    console.info(`account ${account.accountId} (${account.siteId})`);
    expect(account.siteId).toBe("MLB");
  });

  it("creates a Pix charge with a copy-and-paste code and reads it back like the webhook does", async () => {
    expect(payerEmail, "set MP_TEST_PAYER_EMAIL").toMatch(/@/);
    const { mercadoPagoProvider } = await import("./providers/mercado-pago");
    const paymentRequestId = new ObjectId();
    const payment = await inCompany(() => mercadoPagoProvider.createPayment({
      paymentRequestId, amountCents: 100, payerEmail, description: "Teste Oria (cancelado automaticamente)",
    }));
    created.push(payment.externalPaymentId);
    console.info(`created ${payment.externalPaymentId}: status ${payment.status}, Pix code ${payment.qrCode.length} chars, ticket ${Boolean(payment.ticketUrl)}`);
    expect(payment.qrCode.length).toBeGreaterThan(50);

    const fetched = await inCompany(() => mercadoPagoProvider.getPayment(payment.externalPaymentId));
    expect(fetched).toMatchObject({ externalReference: paymentRequestId.toHexString(), amountCents: 100, currency: "BRL" });
  });
});
