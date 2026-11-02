import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";

const collections = vi.hoisted(() => new Map<string, Record<string, ReturnType<typeof vi.fn>>>());

vi.mock("../mongodb", () => ({
  default: Promise.resolve({
    db: () => ({
      databaseName: "ai_secretary",
      collection: (name: string) => {
        if (!collections.has(name)) {
          collections.set(name, Object.fromEntries([
            "find", "findOne", "countDocuments", "updateOne", "updateMany", "deleteOne", "deleteMany",
            "findOneAndUpdate", "findOneAndDelete", "replaceOne", "findOneAndReplace", "insertOne", "insertMany",
            "distinct", "aggregate", "bulkWrite", "createIndex",
          ].map((method) => [method, vi.fn().mockReturnValue("result")])));
        }
        return collections.get(name);
      },
    }),
  }),
}));

import { runWithCompany } from "./context";
import { companyScopedId, legacyCompanyId, unscopedId } from "./ownership";
import { TenantScopeError, tenantDb } from "./tenant-db";

const companyA = new ObjectId();
const companyB = new ObjectId();

function mock(name: string) {
  return collections.get(name)!;
}

describe("tenant-scoped database", () => {
  it("confines reads, updates and deletes of company data to the company in scope", async () => {
    const db = await runWithCompany(companyA, () => tenantDb());
    const customers = db.collection("crm_customers");
    const customerId = new ObjectId();

    customers.find({ name: "Ana" }, { limit: 1 });
    await customers.findOne({ _id: customerId });
    await customers.updateOne({ _id: customerId }, { $set: { name: "Ana" } });
    await customers.deleteMany({});
    await customers.countDocuments();
    await customers.distinct("name", { status: "x" });

    expect(mock("crm_customers").find).toHaveBeenCalledWith({ name: "Ana", companyId: companyA }, { limit: 1 });
    expect(mock("crm_customers").findOne).toHaveBeenCalledWith({ _id: customerId, companyId: companyA });
    expect(mock("crm_customers").updateOne).toHaveBeenCalledWith(
      { _id: customerId, companyId: companyA }, { $set: { name: "Ana" } },
    );
    expect(mock("crm_customers").deleteMany).toHaveBeenCalledWith({ companyId: companyA });
    expect(mock("crm_customers").countDocuments).toHaveBeenCalledWith({ companyId: companyA });
    expect(mock("crm_customers").distinct).toHaveBeenCalledWith("name", { status: "x", companyId: companyA });
  });

  it("isolates two companies using the same identifiers", async () => {
    const id = new ObjectId();
    await (await runWithCompany(companyA, () => tenantDb())).collection("calendar_appointments").findOne({ _id: id });
    await (await runWithCompany(companyB, () => tenantDb())).collection("calendar_appointments").findOne({ _id: id });

    const filters = mock("calendar_appointments").findOne.mock.calls.slice(-2).map(([filter]) => filter);
    expect(filters).toEqual([{ _id: id, companyId: companyA }, { _id: id, companyId: companyB }]);
  });

  it("refuses queries, documents and updates that name another company", async () => {
    const payments = (await tenantDb(companyA)).collection<{ _id?: string; companyId?: ObjectId }>("payment_requests");

    expect(() => payments.findOne({ companyId: companyB })).toThrow(TenantScopeError);
    expect(() => payments.insertOne({ companyId: companyB })).toThrow(TenantScopeError);
    expect(() => payments.replaceOne({ _id: "x" }, { companyId: companyB })).toThrow(TenantScopeError);
    expect(() => payments.updateOne({}, { $set: { companyId: companyB } })).toThrow(TenantScopeError);
    expect(() => payments.watch()).toThrow(TenantScopeError);
  });

  it("stamps the company on inserted and replaced documents", async () => {
    const messages = (await tenantDb(companyA)).collection<{ _id?: string; text: string; companyId?: ObjectId }>("whatsapp_messages");

    await messages.insertOne({ text: "oi" });
    await messages.insertMany([{ text: "a" }, { text: "b", companyId: companyA }]);
    await messages.replaceOne({ _id: "x" }, { text: "c" }, { upsert: true });

    expect(mock("whatsapp_messages").insertOne).toHaveBeenCalledWith({ text: "oi", companyId: companyA });
    expect(mock("whatsapp_messages").insertMany).toHaveBeenCalledWith([
      { text: "a", companyId: companyA }, { text: "b", companyId: companyA },
    ]);
    expect(mock("whatsapp_messages").replaceOne).toHaveBeenCalledWith(
      { _id: "x", companyId: companyA }, { text: "c", companyId: companyA }, { upsert: true },
    );
  });

  it("scopes aggregations, merging into a leading $match", async () => {
    const runs = (await tenantDb(companyA)).collection("assistant_runs");

    runs.aggregate([{ $match: { status: "failed" } }, { $count: "n" }]);
    runs.aggregate([{ $group: { _id: "$status" } }]);

    expect(mock("assistant_runs").aggregate.mock.calls.slice(-2).map(([pipeline]) => pipeline)).toEqual([
      [{ $match: { status: "failed", companyId: companyA } }, { $count: "n" }],
      [{ $match: { companyId: companyA } }, { $group: { _id: "$status" } }],
    ]);
  });

  it("scopes every bulk write operation", async () => {
    const appointments = (await tenantDb(companyA)).collection("calendar_appointments");
    const id = new ObjectId();

    await appointments.bulkWrite([
      { insertOne: { document: { _id: id } } },
      { updateOne: { filter: { _id: id }, update: { $set: { status: "held" } } } },
      { deleteMany: { filter: { status: "x" } } },
    ]);

    expect(mock("calendar_appointments").bulkWrite).toHaveBeenCalledWith([
      { insertOne: { document: { _id: id, companyId: companyA } } },
      { updateOne: { filter: { _id: id, companyId: companyA }, update: { $set: { status: "held" } } } },
      { deleteMany: { filter: { status: "x", companyId: companyA } } },
    ]);
  });

  it("leaves login and platform-level collections global", async () => {
    const db = await tenantDb(companyA);

    await db.collection("users").findOne({ email: "a@b.c" });
    await db.collection<{ _id: string }>("ai_provider_credentials").findOne({ _id: "vercel" });

    expect(mock("users").findOne).toHaveBeenCalledWith({ email: "a@b.c" });
    expect(mock("ai_provider_credentials").findOne).toHaveBeenCalledWith({ _id: "vercel" });
  });
});

describe("per-company settings ids", () => {
  it("keeps the original clinic's ids and prefixes every other company", () => {
    expect(companyScopedId(legacyCompanyId(), "active")).toBe("active");
    expect(companyScopedId(companyA, "active")).toBe(`${companyA.toHexString()}:active`);
    expect(unscopedId(companyA, `${companyA.toHexString()}:active`)).toBe("active");
    expect(unscopedId(companyA, "active")).toBe("active");
  });
});
