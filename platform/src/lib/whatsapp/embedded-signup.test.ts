import { beforeEach, describe, expect, it, vi } from "vitest";

const { findOne, insertOne, replaceOne, updateMany, updateOne } = vi.hoisted(() => ({
  findOne: vi.fn(),
  insertOne: vi.fn(),
  replaceOne: vi.fn(),
  updateMany: vi.fn(),
  updateOne: vi.fn(),
}));

vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({ collection: () => ({ findOne, insertOne, replaceOne, updateMany, updateOne }) }),
  }),
}));

import {
  activateEmbeddedSignupConnection,
  captureCoexistenceWebhookEvent,
  exchangeEmbeddedSignupCode,
  finalizeEmbeddedSignupConnection,
  getEmbeddedSignupConfiguration,
  recoverEmbeddedSignupConnection,
  updateEmbeddedSignupConfiguration,
} from "./embedded-signup";

describe("Embedded Signup configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    findOne.mockResolvedValue(null);
    insertOne.mockResolvedValue({ acknowledged: true });
    replaceOne.mockResolvedValue({ acknowledged: true });
    updateMany.mockResolvedValue({ acknowledged: true });
    updateOne.mockResolvedValue({ acknowledged: true });
    process.env.WHATSAPP_APP_SECRET = "test-app-secret";
    process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  });

  it("returns an unconfigured v25 default", async () => {
    await expect(getEmbeddedSignupConfiguration()).resolves.toMatchObject({
      appId: "",
      configurationId: "",
      graphVersion: "v25.0",
      updatedAt: null,
    });
  });

  it("persists normalized public Meta identifiers", async () => {
    const result = await updateEmbeddedSignupConfiguration({
      appId: " 1234567890 ",
      configurationId: "9876543210",
    });

    expect(result).toMatchObject({ appId: "1234567890", configurationId: "9876543210" });
    expect(replaceOne).toHaveBeenCalledWith(
      { _id: "active" },
      expect.objectContaining({ appId: "1234567890", configurationId: "9876543210" }),
      { upsert: true },
    );
  });

  it("rejects values that are not Meta numeric IDs", async () => {
    await expect(updateEmbeddedSignupConfiguration({
      appId: "app-secret",
      configurationId: "9876543210",
    })).rejects.toThrow("App ID deve conter apenas números.");
  });

  it("encrypts the business token and uses it only to subscribe the coexistence WABA", async () => {
    const accessToken = "business-token-that-must-not-be-stored-in-plain-text";
    findOne.mockResolvedValueOnce({
      _id: "active",
      appId: "1234567890",
      configurationId: "9876543210",
      graphVersion: "v25.0",
      updatedAt: new Date(),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "app-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: accessToken }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "9988776655", is_on_biz_app: true, platform_type: "CLOUD_API" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const exchanged = await exchangeEmbeddedSignupCode("temporary-meta-code-long-enough");
    const exchangeUrl = new URL(fetchMock.mock.calls[1][0]);
    expect(exchangeUrl.searchParams.has("redirect_uri")).toBe(false);
    const storedConnection = insertOne.mock.calls[0][0];
    expect(storedConnection.accessToken.ciphertext).not.toContain(accessToken);
    expect(JSON.stringify(storedConnection)).not.toContain(accessToken);
    findOne.mockResolvedValueOnce(storedConnection);

    await expect(finalizeEmbeddedSignupConnection({
      connectionId: exchanged.connectionId,
      wabaId: "1122334455",
      phoneNumberId: "9988776655",
    })).resolves.toEqual({
      connectionId: exchanged.connectionId,
      wabaId: "1122334455",
      phoneNumberId: "9988776655",
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://graph.facebook.com/v25.0/1122334455/subscribed_apps",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      }),
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: exchanged.connectionId },
      { $set: expect.objectContaining({ status: "connected", phoneNumberId: "9988776655" }) },
    );
  });

  it("makes a connected number operational only through an explicit setting", async () => {
    findOne.mockResolvedValueOnce({
      _id: "11111111-1111-4111-8111-111111111111",
      status: "connected",
      wabaId: "1122334455",
      phoneNumberId: "9988776655",
    });

    await expect(activateEmbeddedSignupConnection("11111111-1111-4111-8111-111111111111"))
      .resolves.toMatchObject({ status: "operational", phoneNumberId: "9988776655" });
    expect(updateMany).toHaveBeenCalledWith(
      { _id: { $ne: "11111111-1111-4111-8111-111111111111" }, status: "operational" },
      { $set: expect.objectContaining({ status: "connected" }) },
    );
    expect(updateOne).toHaveBeenCalledWith(
      { _id: "11111111-1111-4111-8111-111111111111" },
      { $set: expect.objectContaining({ status: "operational" }) },
    );
  });

  it("recovers mobile signup from the matching account update webhook", async () => {
    findOne.mockResolvedValueOnce({
      _id: "active",
      appId: "1234567890",
      configurationId: "9876543210",
      graphVersion: "v25.0",
      updatedAt: new Date(),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "app-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "business-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "9988776655", is_on_biz_app: true, platform_type: "CLOUD_API" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "9988776655", is_on_biz_app: true, platform_type: "CLOUD_API" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const exchanged = await exchangeEmbeddedSignupCode("temporary-meta-code-long-enough");
    const connection = insertOne.mock.calls[0][0];
    const event = {
      _id: "event-1",
      wabaId: "1122334455",
      field: "account_update",
      value: {
        event: "PARTNER_APP_INSTALLED",
        waba_info: { partner_app_id: "1234567890" },
      },
      receivedAt: new Date(),
      processedAt: null,
    };
    findOne
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(connection);

    await expect(recoverEmbeddedSignupConnection({ connectionId: exchanged.connectionId })).resolves.toEqual({
      connectionId: exchanged.connectionId,
      wabaId: "1122334455",
      phoneNumberId: "9988776655",
    });
    expect(findOne).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        field: "account_update",
        "value.event": "PARTNER_APP_INSTALLED",
        "value.waba_info.partner_app_id": "1234567890",
        processedAt: null,
      }),
      { sort: { receivedAt: -1 } },
    );
    expect(updateOne).toHaveBeenLastCalledWith(
      { _id: "event-1" },
      { $set: { processedAt: expect.any(Date) } },
    );
  });

  it("recovers mobile signup from token assets when the session event and webhook are unavailable", async () => {
    findOne.mockResolvedValueOnce({
      _id: "active",
      appId: "1234567890",
      configurationId: "9876543210",
      graphVersion: "v25.0",
      updatedAt: new Date(),
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "app-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "business-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            app_id: "1234567890",
            is_valid: true,
            granular_scopes: [{
              scope: "whatsapp_business_management",
              target_ids: ["1122334455"],
            }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "9988776655", is_on_biz_app: true, platform_type: "CLOUD_API" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "9988776655", is_on_biz_app: true, platform_type: "CLOUD_API" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });
    vi.stubGlobal("fetch", fetchMock);
    const exchanged = await exchangeEmbeddedSignupCode("temporary-meta-code-long-enough");
    const connection = insertOne.mock.calls[0][0];
    findOne
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(connection);

    await expect(recoverEmbeddedSignupConnection({ connectionId: exchanged.connectionId })).resolves.toEqual({
      connectionId: exchanged.connectionId,
      wabaId: "1122334455",
      phoneNumberId: "9988776655",
    });
    expect(fetchMock.mock.calls[2][0]).toContain("/debug_token?");
    const debugUrl = new URL(fetchMock.mock.calls[2][0]);
    expect(debugUrl.searchParams.get("input_token")).toBe("business-token");
    expect(debugUrl.searchParams.get("access_token")).toBe("1234567890|test-app-secret");
    expect(updateOne).toHaveBeenCalledWith(
      { _id: exchanged.connectionId },
      { $set: expect.objectContaining({ status: "connected", wabaId: "1122334455" }) },
    );
  });

  it("returns distinct authorized phone candidates and finalizes the selected number", async () => {
    findOne.mockResolvedValueOnce({
      _id: "active",
      appId: "1234567890",
      configurationId: "9876543210",
      graphVersion: "v25.0",
      updatedAt: new Date(),
    });
    const phones = [
      {
        id: "9988776655",
        display_phone_number: "+55 11 98888-7777",
        verified_name: "Clínica Centro",
        is_on_biz_app: true,
        platform_type: "CLOUD_API",
      },
      {
        id: "8877665544",
        display_phone_number: "+55 42 99999-1111",
        verified_name: "Clínica Ponta Grossa",
        is_on_biz_app: true,
        platform_type: "CLOUD_API",
      },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "app-access-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "business-token" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            app_id: "1234567890",
            is_valid: true,
            granular_scopes: [
              { scope: "whatsapp_business_management", target_ids: ["1122334455"] },
              { scope: "whatsapp_business_messaging", target_ids: ["1122334455"] },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: phones }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: {
            app_id: "1234567890",
            is_valid: true,
            granular_scopes: [{
              scope: "whatsapp_business_management",
              target_ids: ["1122334455"],
            }],
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: phones }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: phones }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
    const exchanged = await exchangeEmbeddedSignupCode("temporary-meta-code-long-enough");
    const connection = insertOne.mock.calls[0][0];
    findOne
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(connection)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(connection);

    await expect(recoverEmbeddedSignupConnection({ connectionId: exchanged.connectionId })).resolves.toEqual({
      selectionRequired: true,
      candidates: [
        {
          wabaId: "1122334455",
          phoneNumberId: "9988776655",
          displayPhoneNumber: "+55 11 98888-7777",
          verifiedName: "Clínica Centro",
        },
        {
          wabaId: "1122334455",
          phoneNumberId: "8877665544",
          displayPhoneNumber: "+55 42 99999-1111",
          verifiedName: "Clínica Ponta Grossa",
        },
      ],
    });
    await expect(recoverEmbeddedSignupConnection({
      connectionId: exchanged.connectionId,
      phoneNumberId: "8877665544",
    })).resolves.toEqual({
      connectionId: exchanged.connectionId,
      wabaId: "1122334455",
      phoneNumberId: "8877665544",
    });
  });

  it("captures coexistence webhook data with a deterministic id", async () => {
    updateOne.mockResolvedValue({ acknowledged: true, upsertedCount: 1 });
    const input = {
      wabaId: "1122334455",
      field: "smb_app_state_sync",
      value: { state_sync: [{ action: "add" }] },
    };

    await expect(captureCoexistenceWebhookEvent(input)).resolves.toBe(true);
    await captureCoexistenceWebhookEvent(input);

    expect(updateOne.mock.calls[0][0]._id).toBe(updateOne.mock.calls[1][0]._id);
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(String) }),
      { $setOnInsert: expect.objectContaining(input) },
      { upsert: true },
    );
  });
});