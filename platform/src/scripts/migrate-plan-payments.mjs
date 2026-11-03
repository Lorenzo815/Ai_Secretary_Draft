// Deposits per scheduling plan: makes every plan's deposit rule explicit and links past deposits to the
// appointments they confirmed. Dry run by default (read-only). Writes only with --apply.
//   node src/scripts/migrate-plan-payments.mjs [--apply] [--company <id>] [--env path/to/.env]
//
// 1. Agent configuration: a plan without `payment` gets the rule it already behaved with: "always" with the
//    clinic-wide amount when its prerequisites required "operations.paymentStatus = paid", else "none". That
//    prerequisite is removed. Saved as a new revision (proposals made before it ask the patient to search again).
// 2. Paid deposits without `paidAt` get it from the staff review time.
// 3. Paid deposits without linked appointments are linked only when it is unambiguous: appointments of the same
//    patient created as a deposit hold and confirmed (updated) within 10 seconds after the payment was confirmed.
//    Anything else stays unlinked and can be linked by staff in Financeiro.
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { MongoClient, ObjectId } from "mongodb";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const envIndex = args.indexOf("--env");
const envFile = envIndex >= 0 ? args[envIndex + 1] : ".env.local";
const companyIndex = args.indexOf("--company");
const onlyCompany = companyIndex >= 0 ? new ObjectId(args[companyIndex + 1]) : null;
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.MONGODB_URI) throw new Error(`MONGODB_URI not found (env file: ${envFile}).`);

const PAYMENT_FIELD = "operations.paymentStatus";
const HOLD_NOTE = "Reserva temporária aguardando confirmação do sinal.";
const CONFIRMATION_WINDOW_MS = 10_000;

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db("ai_secretary");
const companyFilter = onlyCompany ? { companyId: onlyCompany } : {};
console.log(apply ? "APPLY: writing changes." : "DRY RUN: nothing is written. Use --apply to write.");

try {
  await migrateConfigurations();
  await migratePayments();
} finally {
  await client.close();
}

async function migrateConfigurations() {
  const configs = db.collection("assistant_agent_config");
  for (const config of await configs.find(companyFilter).toArray()) {
    const legacyAmount = config.payment?.signalAmountCents ?? 10_000;
    let changed = false;
    const schedulingPlans = (config.schedulingPlans ?? []).map((plan) => {
      if (plan.payment) return plan;
      changed = true;
      const requiresPayment = conditions(plan.prerequisites).some((condition) => condition.field === PAYMENT_FIELD);
      const payment = { requirement: requiresPayment ? "always" : "none", amountCents: legacyAmount };
      console.log(`  config ${config._id} · plan "${plan.name}" (${plan.key}): payment = ${payment.requirement}, R$ ${(payment.amountCents / 100).toFixed(2)}; prerequisites ${JSON.stringify(plan.prerequisites)} -> ${JSON.stringify(withoutPaymentConditions(plan.prerequisites))}`);
      return { ...plan, prerequisites: withoutPaymentConditions(plan.prerequisites), payment };
    });
    if (!changed) {
      console.log(`  config ${config._id}: every plan already has a payment rule.`);
      continue;
    }
    const activeOptions = await db.collection("calendar_plan_options").countDocuments({
      ...(config.companyId ? { companyId: config.companyId } : {}),
      status: "proposed", configRevision: config.revision, expiresAt: { $gt: new Date() },
    });
    console.log(`  config ${config._id}: revision ${config.revision} -> ${config.revision + 1}; ${activeOptions} open proposal(s) will ask for a new search.`);
    if (!apply) continue;
    const next = { ...config, schedulingPlans, revision: config.revision + 1, updatedAt: new Date(), updatedBy: "migration:plan-payments" };
    next.contentHash = contentHash(next);
    const result = await configs.replaceOne({ _id: config._id, revision: config.revision }, next);
    console.log(result.matchedCount === 1 ? "    saved." : "    SKIPPED: the configuration changed meanwhile; run again.");
  }
}

async function migratePayments() {
  const requests = db.collection("payment_requests");
  const appointments = db.collection("calendar_appointments");
  const paid = await requests.find({ ...companyFilter, status: "paid" }).sort({ createdAt: 1 }).toArray();
  let linked = 0;
  for (const request of paid) {
    const label = `  payment ${request._id} (patient …${String(request.customerId).slice(-6)}, R$ ${(request.amountCents / 100).toFixed(2)})`;
    const paidAt = request.paidAt ?? request.reviewedAt ?? request.updatedAt;
    const set = {};
    if (!request.paidAt) set.paidAt = paidAt;
    let appointmentIds = null;
    if (!request.appointmentIds) {
      const confirmedAt = (request.reviewedAt ?? request.paidAt ?? request.updatedAt).getTime();
      const candidates = await appointments.find({
        customerId: request.customerId,
        notes: HOLD_NOTE,
        status: { $in: ["scheduled", "completed"] },
        createdAt: { $lte: new Date(confirmedAt) },
        updatedAt: { $gte: new Date(confirmedAt - 1_000), $lte: new Date(confirmedAt + CONFIRMATION_WINDOW_MS) },
        paymentRequestId: { $exists: false },
      }).toArray();
      const groups = new Set(candidates.map((appointment) => String(appointment.visitGroupId ?? appointment._id)));
      if (candidates.length > 0 && groups.size === 1) {
        appointmentIds = candidates.map((appointment) => appointment._id);
        set.appointmentIds = appointmentIds;
        console.log(`${label}: link ${candidates.map((appointment) => `${appointment.eventType} ${appointment.startAt.toISOString()}`).join(", ")}`);
      } else {
        console.log(`${label}: not linked (${candidates.length === 0 ? "no appointment confirmed at payment time" : "ambiguous"}); staff can link it in Financeiro.`);
      }
    }
    if (set.paidAt) console.log(`${label}: paidAt = ${set.paidAt.toISOString()}`);
    if (!apply || Object.keys(set).length === 0) continue;
    await requests.updateOne({ _id: request._id, status: "paid" }, { $set: { ...set, updatedAt: new Date() } });
    if (appointmentIds) {
      await appointments.updateMany(
        { _id: { $in: appointmentIds }, paymentRequestId: { $exists: false } },
        { $set: { paymentRequestId: request._id, paidAt } },
      );
      linked += 1;
    }
  }
  console.log(`  ${paid.length} paid deposit(s) reviewed${apply ? `; ${linked} linked` : ""}.`);
}

function conditions(group) {
  return [...(group?.all ?? []), ...(group?.any ?? [])];
}

function withoutPaymentConditions(group = {}) {
  const strip = (list) => list?.filter((condition) => condition.field !== PAYMENT_FIELD);
  const all = strip(group.all);
  const any = strip(group.any);
  return { ...(all && all.length ? { all } : {}), ...(any && any.length ? { any } : {}) };
}

// Same as platform/src/lib/assistant/agent/repository.ts (withContentHash / withoutMetadata).
function contentHash(document) {
  const hashInput = {
    enabled: document.enabled,
    identityPrompt: document.identityPrompt,
    conversationPolicy: document.conversationPolicy,
    responseStyle: document.responseStyle,
    offensePolicy: document.offensePolicy,
    handoffPolicy: document.handoffPolicy,
    relationshipRouting: document.relationshipRouting,
    journeyPolicy: document.journeyPolicy,
    knowledge: document.knowledge,
    dataCollectionRules: document.dataCollectionRules,
    schedulingPlans: document.schedulingPlans,
    bookableEventTypeKeys: document.bookableEventTypeKeys,
    enabledTools: document.enabledTools,
    toolGuidance: document.toolGuidance ?? {},
    loopPolicy: document.loopPolicy,
    payment: document.payment,
  };
  return createHash("sha256").update(JSON.stringify(hashInput)).digest("hex");
}
