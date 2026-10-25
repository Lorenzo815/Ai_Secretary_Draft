import { Binary, ObjectId } from "mongodb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyPermissions, type Principal } from "../access/contracts";
import { legacyCompanyId } from "../companies/ownership";
import type { ForwardingEndpoint } from "./forwarding-contracts";

const mocks = vi.hoisted(() => {
  const configuration = { findOne: vi.fn(), replaceOne: vi.fn() };
  const deliveries = { find: vi.fn(), findOne: vi.fn(), insertOne: vi.fn(), bulkWrite: vi.fn(), createIndex: vi.fn(), updateOne: vi.fn(), updateMany: vi.fn(), findOneAndUpdate: vi.fn() };
  const bindings = { find: vi.fn(), findOne: vi.fn() };
  const companies = { findOne: vi.fn(), findOneAndUpdate: vi.fn() };
  const users = { findOne: vi.fn() };
  const session = { withTransaction: vi.fn(), endSession: vi.fn() };
  const db = { collection: (name: string) => ({
    whatsapp_forwarding_config: configuration, whatsapp_forwarding_deliveries: deliveries,
    whatsapp_embedded_signup_connections: bindings, companies, users,
  })[name] };
  const client = { db: () => db, startSession: () => session };
  return { configuration, deliveries, bindings, companies, users, session, client, send: vi.fn(), rows: vi.fn() };
});
vi.mock("../mongodb", () => ({ default: Promise.resolve(mocks.client), getMongoClient: async () => mocks.client }));
vi.mock("./forwarding-http", async importOriginal => ({
  ...await importOriginal<typeof import("./forwarding-http")>(), sendForwardedWebhook: mocks.send,
}));
import {
  enqueueWhatsAppForwarding, getForwardingSettings, processForwardingDeliveries,
  resolveForwardingCompany, saveForwardingSettings, testForwardingEndpoint, validateForwardingEndpoints,
} from "./forwarding";

const scope = legacyCompanyId();
const otherScope = new ObjectId();
const admin = new ObjectId();
const endpoint: ForwardingEndpoint = {
  id: "11111111-1111-4111-8111-111111111111", name: "Platform", url: "https://receiver.example/webhook", enabled: true, maxRetries: 3,
};
const principal: Principal = {
  id: admin.toHexString(), companyId: scope.toHexString(), companyName: "Company A",
  name: "Admin", email: "admin@example.com", isAdmin: true, permissions: emptyPermissions(),
};
const binding = { _id: "connection", companyId: scope, wabaId: "waba-a", phoneNumberId: "phone-a", status: "operational" };
const foreignBinding = { ...binding, _id: "other", companyId: otherScope, wabaId: "waba-b", phoneNumberId: "phone-b" };
const entry = (waba = "waba-a", phone = "phone-a") => ({ id: waba, changes: [{ field: "messages", value: { metadata: { phone_number_id: phone }, messages: [] } }] });
const payload = { object: "whatsapp_business_account", entry: [entry()] };
const rawBody = new Uint8Array(Buffer.from(`{\n "object":"whatsapp_business_account", "entry":${JSON.stringify(payload.entry)}, "extra":"Olá 😀"\n}`));
const signature = `sha256=${"a".repeat(64)}`;
const now = new Date("2026-10-25T12:00:00Z");
let configuration: { revision: number; endpoints: ForwardingEndpoint[] };
let inserted: Record<string, unknown> | null;

function delivery(attempts = 1, overrides: Record<string, unknown> = {}) {
  return {
    _id: new ObjectId(), companyId: scope, endpointId: endpoint.id, endpointName: endpoint.name,
    url: endpoint.url, digest: "digest", body: new Binary(rawBody), signature, isTest: false,
    status: "processing", attempts, maxRetries: 3, dueAt: now, createdAt: now, updatedAt: now,
    leaseToken: "lease", ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", undefined);
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", undefined);
  vi.stubEnv("NEXTAUTH_URL", "https://oria.example");
  configuration = { revision: 1, endpoints: [{ ...endpoint }] };
  inserted = null;
  mocks.configuration.findOne.mockImplementation(async (filter: { companyId?: ObjectId }) =>
    !filter.companyId || filter.companyId.equals(scope) ? configuration : null);
  mocks.companies.findOne.mockImplementation(async (filter: { _id: ObjectId }) =>
    filter._id.equals(scope) ? { _id: scope, adminUserId: admin } : null);
  mocks.companies.findOneAndUpdate.mockResolvedValue({ _id: scope, adminUserId: admin });
  mocks.users.findOne.mockResolvedValue({ _id: admin, disabled: false });
  mocks.session.withTransaction.mockImplementation(async (run: () => Promise<unknown>) => run());
  mocks.bindings.find.mockReturnValue({ toArray: async () => [binding, foreignBinding] });
  mocks.bindings.findOne.mockResolvedValue(binding);
  mocks.rows.mockResolvedValue([]);
  const cursor = { sort: () => cursor, limit: () => cursor, toArray: mocks.rows };
  mocks.deliveries.find.mockReturnValue(cursor);
  mocks.deliveries.findOneAndUpdate.mockResolvedValue(null);
  mocks.deliveries.findOne.mockImplementation(async (filter: { _id?: ObjectId }) => filter._id ? inserted : null);
  mocks.deliveries.insertOne.mockImplementation(async document => { inserted = document; return { insertedId: document._id }; });
  mocks.send.mockResolvedValue({ ok: true, status: 200, durationMs: 12, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("company-scoped forwarding configuration", () => {
  it("accepts five endpoints including disabled ones, but rejects a sixth", () => {
    const endpoints = Array.from({ length: 5 }, (_, index) => ({
      ...endpoint, id: `11111111-1111-4111-8111-11111111111${index}`, url: `https://receiver.example/${index}`, enabled: index === 0,
    }));
    expect(validateForwardingEndpoints(endpoints)).toHaveLength(5);
    expect(() => validateForwardingEndpoints([...endpoints, endpoint])).toThrow("5");
  });
  it.each([-1, 11, 1.5, "3", null])("rejects invalid retry limit %s", maxRetries => {
    expect(() => validateForwardingEndpoints([{ ...endpoint, maxRetries }])).toThrow();
  });
  it.each([0, 10])("accepts retry limit %s", maxRetries => {
    expect(validateForwardingEndpoints([{ ...endpoint, maxRetries }])[0].maxRetries).toBe(maxRetries);
  });
  it("rejects duplicate URLs, duplicate IDs, injected ownership, and unsafe URLs", () => {
    for (const endpoints of [
      [endpoint, { ...endpoint, id: "22222222-2222-4222-8222-222222222222" }],
      [endpoint, { ...endpoint, url: "https://other.example" }],
      [{ ...endpoint, companyId: otherScope.toHexString() }],
      [{ ...endpoint, url: "https://127.0.0.1" }],
    ]) expect(() => validateForwardingEndpoints(endpoints)).toThrow();
  });
  it("returns only the admin company's configuration and safe delivery metadata", async () => {
    mocks.rows.mockResolvedValue([delivery()]);
    const result = await getForwardingSettings(principal);
    expect(mocks.configuration.findOne).toHaveBeenCalledWith({ _id: scope, companyId: scope });
    expect(mocks.deliveries.find).toHaveBeenCalledWith({ companyId: scope });
    expect(result.deliveries[0]).not.toHaveProperty("body");
    expect(result.deliveries[0]).not.toHaveProperty("signature");
    expect(result.deliveries[0]).not.toHaveProperty("url");
  });
  it("denies non-admins and independently rechecks the company's current admin pointer", async () => {
    await expect(getForwardingSettings({ ...principal, isAdmin: false })).rejects.toMatchObject({ status: 403 });
    mocks.companies.findOne.mockResolvedValue(null);
    await expect(getForwardingSettings(principal)).rejects.toMatchObject({ status: 403 });
    expect(mocks.configuration.findOne).not.toHaveBeenCalled();
  });
  it("uses the serialized admin transaction, company scope and optimistic revision when saving", async () => {
    await saveForwardingSettings(principal, { revision: 1, endpoints: [endpoint] });
    expect(mocks.companies.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: scope, adminUserId: admin, status: "active", accessControlVersion: 1 },
      { $inc: { userManagementVersion: 1 } }, { session: mocks.session, returnDocument: "after" },
    );
    expect(mocks.configuration.replaceOne).toHaveBeenCalledWith(
      { _id: scope, companyId: scope },
      expect.objectContaining({ companyId: scope, revision: 2, endpoints: [endpoint], updatedBy: admin }),
      { upsert: false, session: mocks.session },
    );
  });
  it("rejects stale writes and a client-supplied company", async () => {
    await expect(saveForwardingSettings(principal, { revision: 0, endpoints: [] })).rejects.toMatchObject({ status: 409 });
    await expect(saveForwardingSettings(principal, { revision: 1, endpoints: [], companyId: otherScope.toHexString() })).rejects.toThrow();
    expect(mocks.configuration.replaceOne).not.toHaveBeenCalled();
  });
  it("cannot save after admin transfer or into another company", async () => {
    mocks.companies.findOneAndUpdate.mockResolvedValue(null);
    await expect(saveForwardingSettings(principal, { revision: 1, endpoints: [] })).rejects.toMatchObject({ status: 403 });
    await expect(saveForwardingSettings({ ...principal, companyId: otherScope.toHexString() }, { revision: 1, endpoints: [] })).rejects.toMatchObject({ status: 403 });
    expect(mocks.configuration.replaceOne).not.toHaveBeenCalled();
  });
  it("requires an explicitly company-bound WhatsApp connection before activation, but allows disabled setup", async () => {
    mocks.bindings.findOne.mockResolvedValue(null);
    await expect(saveForwardingSettings(principal, { revision: 1, endpoints: [endpoint] })).rejects.toMatchObject({ status: 409 });
    expect(mocks.configuration.replaceOne).not.toHaveBeenCalled();
    await saveForwardingSettings(principal, { revision: 1, endpoints: [{ ...endpoint, enabled: false }] });
    expect(mocks.configuration.replaceOne).toHaveBeenCalledOnce();
  });
});

describe("inbound ownership and durable exact-payload outbox", () => {
  it("resolves the company from registered WhatsApp identifiers, never a customer-supplied company ID", () => {
    expect(resolveForwardingCompany({ ...payload, companyId: otherScope.toHexString() }, [binding, foreignBinding])).toEqual(scope);
  });
  it("resolves WABA-level events without filtering out non-message fields", () => {
    expect(resolveForwardingCompany({
      object: "whatsapp_business_account", entry: [{ id: "waba-a", changes: [{ field: "account_update", value: {} }] }],
    }, [binding])).toEqual(scope);
  });
  it("uses the legacy environment only for its explicitly matching WABA and phone", () => {
    vi.stubEnv("WHATSAPP_BUSINESS_ACCOUNT_ID", "waba-a");
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-a");
    expect(resolveForwardingCompany(payload, [])).toEqual(scope);
    expect(() => resolveForwardingCompany({ ...payload, entry: [entry("waba-b", "phone-a")] }, [])).toThrow();
    expect(() => resolveForwardingCompany({ ...payload, entry: [entry("waba-a", "phone-b")] }, [])).toThrow();
  });
  it("rejects unresolved, ambiguous and mixed-company payloads instead of splitting or leaking them", () => {
    for (const [body, bindings] of [
      [payload, []],
      [payload, [binding, { ...binding, companyId: otherScope }]],
      [{ ...payload, entry: [entry(), entry("waba-b", "phone-b")] }, [binding, foreignBinding]],
    ] as const) expect(() => resolveForwardingCompany(body, [...bindings])).toThrow();
  });
  it("stores the exact bytes and original signature before delivery, with scoped retry-safe deduplication", async () => {
    configuration.endpoints.push({ ...endpoint, id: "22222222-2222-4222-8222-222222222222", enabled: false });
    expect(await enqueueWhatsAppForwarding(rawBody, signature)).toBe(1);
    expect(mocks.send).not.toHaveBeenCalled();
    const operation = mocks.deliveries.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.filter).toMatchObject({ companyId: scope, endpointId: endpoint.id });
    expect(operation.update.$setOnInsert).toMatchObject({ companyId: scope, signature, maxRetries: 3, attempts: 0, status: "pending" });
    expect(Buffer.from(operation.update.$setOnInsert.body.value())).toEqual(Buffer.from(rawBody));
    await enqueueWhatsAppForwarding(rawBody, signature);
    expect(mocks.deliveries.bulkWrite.mock.calls[1][0][0].updateOne.filter).toEqual(operation.filter);
  });
  it("does nothing when forwarding is not configured and does not invent an owner for an empty batch", async () => {
    mocks.configuration.findOne.mockResolvedValueOnce(null);
    expect(await enqueueWhatsAppForwarding(rawBody, signature)).toBe(0);
    expect(mocks.bindings.find).not.toHaveBeenCalled();
    expect(await enqueueWhatsAppForwarding(Buffer.from('{"object":"whatsapp_business_account","entry":[]}'), signature)).toBe(0);
    expect(mocks.deliveries.bulkWrite).not.toHaveBeenCalled();
  });
  it("fails before any outbox writes for mixed ownership or a persistence error", async () => {
    await expect(enqueueWhatsAppForwarding(Buffer.from(JSON.stringify({ ...payload, entry: [entry(), entry("waba-b", "phone-b")] })), signature)).rejects.toThrow("MIXED_COMPANIES");
    expect(mocks.deliveries.bulkWrite).not.toHaveBeenCalled();
    mocks.deliveries.bulkWrite.mockRejectedValue(new Error("database failed"));
    await expect(enqueueWhatsAppForwarding(rawBody, signature)).rejects.toThrow("database failed");
  });
});

describe("bounded retries, leases and test deliveries", () => {
  it("marks HTTP 200 delivered, removes raw personal data, and scopes completion to company and lease", async () => {
    const job = delivery();
    mocks.deliveries.findOneAndUpdate.mockResolvedValueOnce(job);
    expect(await processForwardingDeliveries()).toBe(1);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.any(Uint8Array), signature, deliveryId: job._id.toHexString(), isTest: false,
    }));
    expect(mocks.deliveries.updateOne).toHaveBeenCalledWith(
      { _id: job._id, companyId: scope, status: "processing", leaseToken: "lease" },
      expect.objectContaining({
        $set: expect.objectContaining({ status: "delivered", lastStatus: 200, expiresAt: expect.any(Date) }),
        $unset: { body: "", signature: "", leaseUntil: "", leaseToken: "" },
      }),
    );
  });
  it.each([[1, 30_000], [2, 60_000], [3, 120_000], [10, 3_600_000]])("backs off failed attempt %s by %s ms", async (attempts, delay) => {
    mocks.deliveries.findOneAndUpdate.mockResolvedValueOnce(delivery(attempts, { maxRetries: 10 }));
    mocks.send.mockResolvedValue({ ok: false, status: 503, durationMs: 12, error: "HTTP 503" });
    await processForwardingDeliveries();
    expect(mocks.deliveries.updateOne).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      $set: expect.objectContaining({ status: "pending", dueAt: new Date(now.getTime() + delay), lastStatus: 503 }),
      $unset: { leaseUntil: "", leaseToken: "" },
    }));
  });
  it.each([[4, 3], [1, 0], [11, 10]])("stops at attempt %s for maxRetries %s", async (attempts, maxRetries) => {
    mocks.deliveries.findOneAndUpdate.mockResolvedValueOnce(delivery(attempts, { maxRetries }));
    mocks.send.mockResolvedValue({ ok: false, status: 500, durationMs: 12, error: "HTTP 500" });
    await processForwardingDeliveries();
    expect(mocks.deliveries.updateOne).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      $set: expect.objectContaining({ status: "failed" }), $unset: expect.objectContaining({ body: "", signature: "" }),
    }));
    expect(mocks.deliveries.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({
      $expr: { $lt: ["$attempts", { $add: ["$maxRetries", 1] }] },
    }), expect.objectContaining({ $inc: { attempts: 1 } }), expect.any(Object));
  });
  it("does not redirect an old payload to an edited, disabled, removed or foreign endpoint", async () => {
    for (const endpoints of [[], [{ ...endpoint, enabled: false }], [{ ...endpoint, url: "https://changed.example" }]]) {
      configuration.endpoints = endpoints;
      mocks.deliveries.findOneAndUpdate.mockResolvedValueOnce(delivery());
      await processForwardingDeliveries();
    }
    mocks.deliveries.findOneAndUpdate.mockResolvedValueOnce(delivery(1, { companyId: otherScope }));
    await processForwardingDeliveries();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.deliveries.updateOne).toHaveBeenLastCalledWith(expect.objectContaining({ companyId: otherScope }), expect.objectContaining({
      $set: expect.objectContaining({ status: "cancelled" }),
    }));
  });
  it("expires abandoned final attempts rather than exceeding the retry cap", async () => {
    await processForwardingDeliveries();
    expect(mocks.deliveries.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      status: "processing", leaseUntil: { $lte: now },
      $expr: { $gte: ["$attempts", { $add: ["$maxRetries", 1] }] },
    }), expect.objectContaining({ $set: expect.objectContaining({ status: "failed" }) }));
  });
  it("tests only a saved company endpoint with synthetic data, no automatic retries, and a visible result", async () => {
    const result = await testForwardingEndpoint(principal, endpoint.id);
    expect(result.result).toMatchObject({ ok: true, status: 200 });
    expect(mocks.deliveries.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      companyId: scope, endpointId: endpoint.id, isTest: true, maxRetries: 0, attempts: 1,
    }), { session: mocks.session });
    const body = mocks.send.mock.calls[0][0].body;
    expect(JSON.parse(Buffer.from(body).toString("utf8"))).toEqual({ object: "whatsapp_business_account", entry: [] });
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ isTest: true }));
  });
  it("tests disabled destinations before activation without forwarding real events to them", async () => {
    configuration.endpoints[0].enabled = false;
    expect((await testForwardingEndpoint(principal, endpoint.id)).result?.ok).toBe(true);
    expect(mocks.send).toHaveBeenCalledWith(expect.objectContaining({ isTest: true }));
  });
  it("rejects foreign destinations and rate-limits tests per company", async () => {
    await expect(testForwardingEndpoint(principal, "not-owned")).rejects.toMatchObject({ status: 409 });
    mocks.deliveries.findOne.mockResolvedValue({ createdAt: now });
    await expect(testForwardingEndpoint(principal, endpoint.id)).rejects.toMatchObject({ status: 429 });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
