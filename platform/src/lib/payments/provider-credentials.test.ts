import { beforeEach, describe, expect, it, vi } from "vitest";

const { deleteOne, findOne, replaceOne } = vi.hoisted(() => ({
  deleteOne: vi.fn(),
  findOne: vi.fn(),
  replaceOne: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({ db: () => ({ collection: () => ({ deleteOne, findOne, replaceOne }) }) }),
}));

import {
  clearStoredMercadoPagoCredential,
  getMercadoPagoCredential,
  saveMercadoPagoCredential,
} from "./provider-credentials";

describe("Mercado Pago credentials", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.MERCADO_PAGO_ACCESS_TOKEN;
    delete process.env.MERCADO_PAGO_WEBHOOK_SECRET;
    process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 6).toString("base64");
    findOne.mockResolvedValue(null);
  });

  it("stores both secrets encrypted and decrypts the database fallback", async () => {
    const accessToken = "APP_USR-test-access-token-123456";
    const webhookSecret = "webhook-secret-123456";
    await saveMercadoPagoCredential({ accessToken, webhookSecret, updatedBy: "admin@example.com" });
    const stored = replaceOne.mock.calls[0][1];
    expect(JSON.stringify(stored)).not.toContain(accessToken);
    expect(JSON.stringify(stored)).not.toContain(webhookSecret);
    findOne.mockResolvedValue({ _id: "mercado_pago", ...stored });
    await expect(getMercadoPagoCredential()).resolves.toEqual({ accessToken, webhookSecret, source: "database" });
  });

  it("prefers a complete environment credential", async () => {
    process.env.MERCADO_PAGO_ACCESS_TOKEN = "APP_USR-environment-token-123456";
    process.env.MERCADO_PAGO_WEBHOOK_SECRET = "environment-webhook-secret";
    await expect(getMercadoPagoCredential()).resolves.toMatchObject({ source: "environment" });
    expect(findOne).not.toHaveBeenCalled();
  });

  it("removes only the stored Mercado Pago credential", async () => {
    await clearStoredMercadoPagoCredential();
    expect(deleteOne).toHaveBeenCalledWith({ _id: "mercado_pago" });
  });
});