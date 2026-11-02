import "server-only";

import type { Collection } from "mongodb";
import { currentCompanyId } from "../companies/context";
import { companyScopedId, unscopedId, withCompany } from "../companies/ownership";
import type { AutomationRuleDocument } from "./contracts";
import { createDefaultAutomationRules } from "./defaults";
import { tenantDb } from "../companies/tenant-db";

const DB_NAME = "ai_secretary";
const RETIRED_RULE_IDS = ["lead-qualification-on-profile"];

async function getCollection(): Promise<Collection<AutomationRuleDocument>> {
  return (await tenantDb()).collection<AutomationRuleDocument>("automation_rules");
}

export async function listAutomationRules() {
  const collection = await getCollection();
  const defaults = createDefaultAutomationRules();
  const companyId = await currentCompanyId();
  await Promise.all([
    collection.deleteMany({ companyId, _id: { $in: RETIRED_RULE_IDS.map((id) => companyScopedId(companyId, id)) } }),
    ...defaults.map((rule) => collection.updateOne(
      { _id: companyScopedId(companyId, rule._id) },
      { $setOnInsert: withCompany({ ...rule, _id: companyScopedId(companyId, rule._id) }, companyId) },
      { upsert: true },
    )),
  ]);
  const stored = await collection.find({ companyId }).toArray();
  return stored
    .map((rule) => ({ ...rule, _id: unscopedId(companyId, rule._id) }))
    .sort((left, right) => left._id.localeCompare(right._id));
}

export async function replaceAutomationRules(input: {
  rules: AutomationRuleDocument[];
  updatedBy: string;
}) {
  validateRules(input.rules);
  const collection = await getCollection();
  const companyId = await currentCompanyId();
  const ids = input.rules.map((rule) => companyScopedId(companyId, rule._id));
  await Promise.all(input.rules.map((rule) => collection.replaceOne(
    { _id: companyScopedId(companyId, rule._id) },
    withCompany({
      _id: companyScopedId(companyId, rule._id),
      name: rule.name,
      enabled: rule.enabled,
      process: rule.process,
      event: rule.event,
      conditions: rule.conditions,
      debounceMs: rule.debounceMs,
      cooldownMinutes: rule.cooldownMinutes,
      rerunWhenSourceChanges: rule.rerunWhenSourceChanges,
      updatedAt: new Date(),
      updatedBy: input.updatedBy,
    }, companyId),
    { upsert: true },
  )));
  await collection.deleteMany({ companyId, _id: { $nin: ids } });
  return listAutomationRules();
}

function validateRules(rules: AutomationRuleDocument[]) {
  if (new Set(rules.map((rule) => rule._id)).size !== rules.length) {
    throw new Error("Regras de automação não podem ter identificadores duplicados.");
  }
  for (const rule of rules) {
    if (!rule._id.trim() || !rule.name.trim()) throw new Error("Toda regra de automação precisa de identificador e nome.");
    if (rule.process !== "customer_agent") {
      throw new Error("Qualificação e follow-up são acionados exclusivamente pelo fluxo interno de follow-up.");
    }
    if (!Number.isInteger(rule.debounceMs) || rule.debounceMs < 0 || rule.debounceMs > 24 * 60 * 60 * 1_000) {
      throw new Error(`Debounce inválido na regra ${rule.name}.`);
    }
    if (!Number.isInteger(rule.cooldownMinutes) || rule.cooldownMinutes < 0 || rule.cooldownMinutes > 30 * 24 * 60) {
      throw new Error(`Cooldown inválido na regra ${rule.name}.`);
    }
  }
}