import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyCompanyId } from "./companies/ownership";

const database = vi.hoisted(() => {
  interface StoredCollection {
    document: Record<string, unknown> | null;
    findOne: ReturnType<typeof vi.fn>;
    insertOne: ReturnType<typeof vi.fn>;
    updateOne: ReturnType<typeof vi.fn>;
    replaceOne: ReturnType<typeof vi.fn>;
  }
  const collections = new Map<string, StoredCollection>();
  return {
    collections,
    collection(name: string) {
      let collection = collections.get(name);
      if (!collection) {
        const stored: StoredCollection = {
          document: null,
          findOne: vi.fn(async () => stored.document),
          insertOne: vi.fn(async (document: Record<string, unknown>) => {
            stored.document = document;
            return { insertedId: document._id };
          }),
          updateOne: vi.fn(async (_filter, update: {
            $setOnInsert?: Record<string, unknown>;
            $set?: Record<string, unknown>;
            $unset?: Record<string, unknown>;
          }) => {
            stored.document ??= update.$setOnInsert ?? null;
            if (stored.document && update.$set) Object.assign(stored.document, update.$set);
            for (const key of Object.keys(update.$unset ?? {})) delete stored.document?.[key];
            return { upsertedCount: 1 };
          }),
          replaceOne: vi.fn(async (_filter, document: Record<string, unknown>) => {
            stored.document = document;
            return { matchedCount: 1 };
          }),
        };
        collection = stored;
        collections.set(name, collection);
      }
      return collection;
    },
  };
});

vi.mock("./mongodb", () => ({ default: Promise.resolve({ db: () => database }) }));
vi.mock("./assistant/tools", () => ({ isAssistantToolKey: () => true }));
vi.mock("./qualification/triggers", () => ({ scheduleFirstAppointmentQualification: vi.fn() }));

import { getAgentConfiguration, updateAgentConfiguration } from "./assistant/agent/repository";
import { getFollowUpConfiguration, updateFollowUpConfiguration } from "./follow-up/config";
import { getLeadQualificationConfiguration, updateLeadQualificationConfiguration } from "./qualification/config";
import { getAiProviderConfiguration, updateAiProviderConfiguration } from "./ai/provider-config";
import { getPaymentProviderConfiguration, updatePaymentProviderConfiguration } from "./payments/provider-config";
import { getCalendarSettings, updateCalendarSettings } from "./calendar/calendar";
import { getEmbeddedSignupConfiguration, updateEmbeddedSignupConfiguration } from "./whatsapp/embedded-signup";

function singleton<T extends object>(
  collection: string,
  load: () => Promise<T>,
  save: (document: T) => Promise<unknown>,
) {
  return { collection, load, save: (document: unknown) => save(document as T) };
}

const singletons = [
  singleton("assistant_agent_config", getAgentConfiguration, document => updateAgentConfiguration({
    expectedRevision: document.revision, updatedBy: "test", configuration: document,
  })),
  singleton("assistant_follow_up_config", getFollowUpConfiguration, document => updateFollowUpConfiguration({
    ...document, expectedRevision: document.revision, updatedBy: "test",
  })),
  singleton("lead_qualification_config", getLeadQualificationConfiguration, document => updateLeadQualificationConfiguration({
    ...document, expectedRevision: document.revision, updatedBy: "test",
  })),
  singleton("ai_model_config", getAiProviderConfiguration, document => updateAiProviderConfiguration({
    ...document, expectedRevision: document.revision, updatedBy: "test",
  })),
  singleton("payment_provider_config", getPaymentProviderConfiguration, document => updatePaymentProviderConfiguration({
    ...document, updatedBy: "test",
  })),
  singleton("calendar_settings", getCalendarSettings, updateCalendarSettings),
  singleton("whatsapp_embedded_signup_config", getEmbeddedSignupConfiguration, document => updateEmbeddedSignupConfiguration({
    ...document, appId: "123456789", configurationId: "987654321",
  })),
];

beforeEach(() => {
  database.collections.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T19:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe.each(singletons)("$collection ownership", specification => {
  it("stamps initial persistence and full replacement without changing returned business data", async () => {
    const initial = await specification.load();
    const collection = database.collection(specification.collection);
    if (specification.collection !== "whatsapp_embedded_signup_config") {
      expect(collection.document).toEqual({ ...initial, companyId: legacyCompanyId() });
    } else {
      expect(collection.document).toBeNull();
    }
    const saved = await specification.save(initial);
    expect(collection.document).toEqual({ ...saved as object, companyId: legacyCompanyId() });
  });

  it("does not migrate, rewrite or change business metadata when a valid configuration is backfilled", async () => {
    await specification.save(await specification.load());
    await specification.load();
    const collection = database.collection(specification.collection);
    const baseline = { ...collection.document };
    delete baseline.companyId;
    const backfilled = { ...baseline, companyId: legacyCompanyId() };
    collection.document = backfilled;
    collection.replaceOne.mockClear();
    collection.updateOne.mockClear();
    collection.insertOne.mockClear();

    expect(await specification.load()).toEqual(backfilled);
    expect(collection.document).toBe(backfilled);
    expect(collection.replaceOne).not.toHaveBeenCalled();
    expect(collection.updateOne).not.toHaveBeenCalled();
    expect(collection.insertOne).not.toHaveBeenCalled();
    expect(collection.document).toMatchObject({
      updatedAt: baseline.updatedAt,
      ...(baseline.revision === undefined ? {} : { revision: baseline.revision }),
      ...(baseline.contentHash === undefined ? {} : { contentHash: baseline.contentHash }),
    });

    collection.document = baseline;
    const withoutOwnership = await specification.save(await specification.load());
    const unownedResult = { ...withoutOwnership as object };
    collection.document = backfilled;
    const withOwnership = await specification.save(await specification.load());
    const ownedResult = { ...withOwnership as object };
    delete (unownedResult as Record<string, unknown>).companyId;
    delete (ownedResult as Record<string, unknown>).companyId;
    expect(ownedResult).toEqual(unownedResult);
    expect(collection.document?.companyId).toEqual(legacyCompanyId());
  });

  it("accepts configuration clients round-tripping serialized ownership metadata", async () => {
    await specification.save(await specification.load());
    const collection = database.collection(specification.collection);
    const serialized: unknown = JSON.parse(JSON.stringify(collection.document));

    await specification.save(serialized);

    expect(collection.document?.companyId).toEqual(legacyCompanyId());
  });
});
