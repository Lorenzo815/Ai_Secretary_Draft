import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { config } from "dotenv";
import { MongoClient, ObjectId } from "mongodb";

config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });

const DATABASE_NAME = "ai_secretary";
const COLLECTIONS = [
  "crm_customers",
  "whatsapp_messages",
  "assistant_conversation_states",
  "assistant_runs",
  "assistant_run_steps",
  "ai_task_calls",
  "automation_jobs",
  "calendar_plan_options",
  "calendar_appointments",
  "payment_requests",
  "lead_qualification_history",
];

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI is not configured in .env.local.");
}

const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const outputDirectory = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), `oria-conversation-audit-${timestamp}`));
const rawDirectory = path.join(outputDirectory, "raw");
const conversationsDirectory = path.join(outputDirectory, "conversations");
const client = new MongoClient(process.env.MONGODB_URI);

try {
  await client.connect();
  const database = client.db(DATABASE_NAME);
  const data = Object.fromEntries(await Promise.all(COLLECTIONS.map(async (collectionName) => [
    collectionName,
    await database.collection(collectionName).find({}).toArray(),
  ])));

  await mkdir(rawDirectory, { recursive: true });
  await mkdir(conversationsDirectory, { recursive: true });

  for (const collectionName of COLLECTIONS) {
    await writeJson(path.join(rawDirectory, `${collectionName}.json`), data[collectionName]);
  }

  const audit = buildAudit(data);
  for (const conversation of audit.conversations) {
    const prefix = String(conversation.index).padStart(3, "0");
    await writeJson(
      path.join(conversationsDirectory, `${prefix}-${safeFileName(conversation.customerId)}.json`),
      conversation,
    );
    await writeFile(
      path.join(conversationsDirectory, `${prefix}-${safeFileName(conversation.customerId)}.md`),
      renderConversation(conversation),
      "utf8",
    );
  }

  await writeJson(path.join(outputDirectory, "manifest.json"), audit.manifest);
  await writeJson(path.join(outputDirectory, "analysis.json"), audit.analysis);
  await writeJson(path.join(outputDirectory, "unlinked-records.json"), audit.unlinkedRecords);
  await writeFile(path.join(outputDirectory, "analysis.md"), renderAnalysis(audit), "utf8");
  await writeFile(
    path.join(outputDirectory, "README.txt"),
    [
      "Oria conversation audit export",
      "",
      `Generated: ${audit.manifest.generatedAt}`,
      "Contains sensitive customer conversations and profile data.",
      "Keep this directory local, restrict access, and delete it after the audit.",
      "The export is read-only: no MongoDB records were changed.",
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(JSON.stringify({
    outputDirectory,
    conversations: audit.conversations.length,
    messages: data.whatsapp_messages.length,
    modelCalls: data.ai_task_calls.length,
    issueCounts: audit.analysis.issueCounts,
  }, null, 2));
} finally {
  await client.close();
}

function buildAudit(data) {
  const customers = data.crm_customers;
  const customerById = new Map(customers.map((customer) => [idOf(customer._id), customer]));
  const customerByPhone = new Map();
  for (const customer of customers) {
    for (const phone of customer.phones ?? []) customerByPhone.set(normalizePhone(phone), customer);
  }

  const issues = [];
  const resolvedMessages = data.whatsapp_messages.map((message) => ({
    record: message,
    customerId: resolveCustomerId(message, customerById, customerByPhone),
  }));
  const observedCustomerIds = new Set(customerById.keys());
  for (const collectionName of COLLECTIONS) {
    for (const record of data[collectionName]) {
      if (record.customerId) observedCustomerIds.add(idOf(record.customerId));
    }
  }
  for (const message of resolvedMessages) {
    if (message.customerId) observedCustomerIds.add(message.customerId);
  }

  const stepsByRunId = groupBy(data.assistant_run_steps, (step) => idOf(step.runId));
  const duplicateMessageIds = findDuplicates(data.whatsapp_messages, (message) => message.metaMessageId);
  for (const duplicate of duplicateMessageIds) {
    addIssue(issues, "error", "duplicate_message_id", `Meta message ID repetido ${duplicate.key}.`, {
      count: duplicate.count,
    });
  }

  for (const message of data.whatsapp_messages) {
    const customerId = resolveCustomerId(message, customerById, customerByPhone);
    if (!message.customerId) {
      addIssue(issues, customerId ? "warning" : "error", "message_missing_customer_id", "Mensagem sem customerId persistido.", {
        customerId,
        messageId: idOf(message._id),
        metaMessageId: message.metaMessageId,
      });
    } else if (!customerById.has(idOf(message.customerId))) {
      addIssue(issues, "error", "message_unknown_customer", "Mensagem referencia um cliente inexistente.", {
        customerId: idOf(message.customerId),
        messageId: idOf(message._id),
      });
    }
    if (message.status === "failed") {
      addIssue(issues, "error", "message_delivery_failed", "Mensagem do WhatsApp com status failed.", {
        customerId,
        messageId: idOf(message._id),
        timestamp: message.timestamp,
      });
    }
    if (!String(message.body ?? "").trim()) {
      addIssue(issues, "warning", "empty_message_body", "Mensagem persistida sem conteúdo textual.", {
        customerId,
        messageId: idOf(message._id),
        type: message.type,
      });
    }
    const paragraphs = String(message.body ?? "").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
    const duplicatedParagraphs = findDuplicates(paragraphs, (paragraph) => paragraph).filter((duplicate) => duplicate.count > 1);
    if (message.direction === "outbound" && duplicatedParagraphs.length > 0) {
      addIssue(issues, "warning", "duplicate_response_paragraph", "Resposta enviada com parágrafo repetido.", {
        customerId,
        messageId: idOf(message._id),
        timestamp: message.timestamp,
        duplicatedParagraphs: duplicatedParagraphs.map((duplicate) => duplicate.key),
      });
    }
  }

  for (const call of data.ai_task_calls) {
    const customerId = call.customerId ? idOf(call.customerId) : null;
    if (call.status !== "completed") {
      addIssue(issues, "error", "model_call_not_completed", `Chamada de modelo terminou como ${call.status ?? "sem status"}.`, {
        customerId,
        modelCallId: idOf(call._id),
        taskKey: call.taskKey,
        model: call.model,
        errorName: call.errorName,
        errorMessage: call.errorMessage,
      });
    }
    if (call.status === "completed" && !call.normalizedUsage && !call.usage) {
      addIssue(issues, "warning", "model_usage_missing", "Chamada concluída sem metadados de tokens.", {
        customerId,
        modelCallId: idOf(call._id),
        taskKey: call.taskKey,
        model: call.model,
      });
    }
    if (call.finishReason && call.finishReason !== "stop") {
      addIssue(issues, "warning", "unexpected_finish_reason", `Chamada terminou com finishReason ${call.finishReason}.`, {
        customerId,
        modelCallId: idOf(call._id),
        taskKey: call.taskKey,
        model: call.model,
      });
    }
  }

  for (const job of data.automation_jobs) {
    addIssue(issues, job.status === "failed" ? "error" : "warning", "automation_job_remaining", `Job permaneceu na fila com status ${job.status}.`, {
      customerId: idOf(job.customerId),
      jobId: idOf(job._id),
      process: job.process,
      consecutiveFailures: job.consecutiveFailures,
      lastError: job.lastError,
    });
  }

  for (const run of data.assistant_runs) {
    const customerId = idOf(run.customerId);
    const runId = idOf(run._id);
    const steps = [...(stepsByRunId.get(runId) ?? [])].sort((first, second) => first.iteration - second.iteration);
    if (run.status === "failed" || run.status === "running") {
      addIssue(issues, "error", "agent_run_not_completed", `Execução do agente terminou como ${run.status}.`, {
        customerId,
        runId,
        error: run.error,
      });
    } else if (run.status === "superseded") {
      addIssue(issues, "info", "agent_run_superseded", "Execução substituída porque chegou uma mensagem mais nova.", {
        customerId,
        runId,
      });
      if (run.mutationsExecuted > 0) {
        addIssue(issues, "error", "superseded_run_with_mutation", "Execução substituída deixou uma mutação persistida antes de ser cancelada.", {
          customerId,
          runId,
          mutationsExecuted: run.mutationsExecuted,
        });
      }
    }

    const duplicateIterations = findDuplicates(steps, (step) => String(step.iteration));
    for (const duplicate of duplicateIterations) {
      addIssue(issues, "error", "duplicate_run_iteration", `Iteração ${duplicate.key} repetida na mesma execução.`, {
        customerId,
        runId,
        count: duplicate.count,
      });
    }

    const finalSteps = steps.filter((step) => step.action?.type === "final");
    if (run.status === "completed" && finalSteps.length !== 1) {
      addIssue(issues, "error", "completed_run_invalid_final_count", `Execução concluída possui ${finalSteps.length} passos finais.`, {
        customerId,
        runId,
      });
    }
    if (run.status === "completed" && steps.length !== run.modelIterations) {
      addIssue(issues, "warning", "run_iteration_count_mismatch", `Execução registra ${run.modelIterations} iterações, mas possui ${steps.length} passos.`, {
        customerId,
        runId,
      });
    }
    const finalDecision = finalSteps[0]?.action?.decision;
    if (run.finalDecision && finalDecision && run.finalDecision !== finalDecision) {
      addIssue(issues, "error", "run_final_decision_mismatch", "A decisão final do run diverge do passo final.", {
        customerId,
        runId,
        runDecision: run.finalDecision,
        stepDecision: finalDecision,
      });
    }

    const limits = run.configSnapshot?.loopPolicy;
    if (limits && run.modelIterations > limits.maxModelIterations) {
      addIssue(issues, "error", "model_iteration_limit_exceeded", "Execução excedeu o limite de iterações do modelo.", {
        customerId,
        runId,
        actual: run.modelIterations,
        limit: limits.maxModelIterations,
      });
    }
    if (limits && run.toolExecutions > limits.maxToolExecutions) {
      addIssue(issues, "error", "tool_execution_limit_exceeded", "Execução excedeu o limite de tools.", {
        customerId,
        runId,
        actual: run.toolExecutions,
        limit: limits.maxToolExecutions,
      });
    }
    if (limits && run.mutationsExecuted > limits.maxMutations) {
      addIssue(issues, "error", "mutation_limit_exceeded", "Execução excedeu o limite de mutações.", {
        customerId,
        runId,
        actual: run.mutationsExecuted,
        limit: limits.maxMutations,
      });
    }

    const toolNames = steps.flatMap((step) => step.action?.type === "tool_request" ? [step.action.toolCall?.tool] : []);
    const bookingIndex = toolNames.indexOf("calendar.book_plan_option");
    const updateIndex = toolNames.indexOf("calendar.update_appointment");
    if (bookingIndex >= 0 && updateIndex > bookingIndex) {
      addIssue(issues, "error", "book_then_update_in_same_run", "Reagendamento reservou uma nova opção antes de tentar mover os compromissos antigos.", {
        customerId,
        runId,
        toolSequence: toolNames,
      });
    }

    const fingerprints = new Map();
    for (const step of steps) {
      if (step.action?.type !== "tool_request") continue;
      const toolCall = step.action.toolCall ?? {};
      const fingerprint = JSON.stringify(toolCall);
      fingerprints.set(fingerprint, (fingerprints.get(fingerprint) ?? 0) + 1);
      for (const result of extractToolResults(step)) {
        if (result?.ok !== false) continue;
        addIssue(issues, "warning", "tool_result_failed", `Tool ${toolCall.tool ?? "desconhecida"} retornou falha.`, {
          customerId,
          runId,
          stepId: idOf(step._id),
          iteration: step.iteration,
          tool: toolCall.tool,
          result,
        });
      }
    }
    for (const [fingerprint, count] of fingerprints) {
      if (count < 2) continue;
      addIssue(issues, "warning", "repeated_tool_call", "A mesma chamada de tool foi repetida na execução.", {
        customerId,
        runId,
        count,
        toolCall: JSON.parse(fingerprint),
      });
    }
  }

  const knownRunIds = new Set(data.assistant_runs.map((run) => idOf(run._id)));
  for (const step of data.assistant_run_steps) {
    if (!knownRunIds.has(idOf(step.runId))) {
      addIssue(issues, "error", "step_unknown_run", "Passo referencia uma execução inexistente.", {
        customerId: idOf(step.customerId),
        runId: idOf(step.runId),
        stepId: idOf(step._id),
      });
    }
  }

  const scheduledAppointments = data.calendar_appointments.filter((appointment) => appointment.status === "scheduled");
  const appointmentsByGroup = groupBy(scheduledAppointments.filter((appointment) => appointment.visitGroupId), (appointment) => idOf(appointment.visitGroupId));
  const bookedOptionsByGroup = new Map(data.calendar_plan_options
    .filter((option) => option.status === "booked" && option.appointmentGroupId)
    .map((option) => [idOf(option.appointmentGroupId), option]));
  const activePlanGroupsByCustomerAndPlan = new Map();
  for (const [groupId, appointments] of appointmentsByGroup) {
    const option = bookedOptionsByGroup.get(groupId);
    if (!option) continue;
    const key = `${idOf(option.customerId)}:${option.planKey}`;
    const groups = activePlanGroupsByCustomerAndPlan.get(key) ?? [];
    groups.push({ groupId, optionId: idOf(option._id), appointmentIds: appointments.map((appointment) => idOf(appointment._id)) });
    activePlanGroupsByCustomerAndPlan.set(key, groups);
  }
  for (const [key, groups] of activePlanGroupsByCustomerAndPlan) {
    if (groups.length < 2) continue;
    const [customerId, planKey] = key.split(":");
    addIssue(issues, "error", "multiple_active_plan_bookings", `Cliente possui ${groups.length} reservas ativas para o plano ${planKey}.`, {
      customerId,
      planKey,
      groups,
    });
  }
  for (const option of data.calendar_plan_options.filter((item) => item.status === "booked" && item.appointmentGroupId)) {
    const groupId = idOf(option.appointmentGroupId);
    if (appointmentsByGroup.has(groupId)) continue;
    addIssue(issues, "warning", "booked_option_without_appointments", "Opção permanece como booked, mas seus compromissos não existem mais.", {
      customerId: idOf(option.customerId),
      optionId: idOf(option._id),
      appointmentGroupId: groupId,
      bookedAt: option.bookedAt,
    });
  }

  const conversations = [...observedCustomerIds].sort().map((customerId, index) => {
    const customer = customerById.get(customerId) ?? null;
    const messages = resolvedMessages
      .filter((message) => message.customerId === customerId)
      .map((message) => message.record)
      .sort(byDate("timestamp"));
    const runs = data.assistant_runs.filter((run) => idOf(run.customerId) === customerId).sort(byDate("startedAt"));
    const runIds = new Set(runs.map((run) => idOf(run._id)));
    const runSteps = data.assistant_run_steps.filter((step) => runIds.has(idOf(step.runId))).sort(byDate("createdAt"));
    const jobs = data.automation_jobs.filter((job) => idOf(job.customerId) === customerId).sort(byDate("createdAt"));

    if (messages.length > 0 && messages.at(-1)?.direction === "inbound" && jobs.length === 0) {
      const waitingForHuman = ["waiting_human", "human_active", "closed"].includes(customer?.serviceStatus);
      addIssue(
        issues,
        waitingForHuman ? "info" : "warning",
        "latest_inbound_without_reply",
        waitingForHuman
          ? "A conversa termina em inbound e está fora do atendimento ativo da IA."
          : "A conversa termina em inbound, está ativa na IA e não possui job pendente.",
        { customerId, messageId: idOf(messages.at(-1)?._id), serviceStatus: customer?.serviceStatus ?? null },
      );
    }

    return {
      index: index + 1,
      customerId,
      customer,
      messages,
      conversationState: data.assistant_conversation_states.find((state) => idOf(state.customerId) === customerId) ?? null,
      runs,
      runSteps,
      modelCalls: data.ai_task_calls.filter((call) => idOf(call.customerId) === customerId).sort(byDate("startedAt")),
      automationJobs: jobs,
      schedulingOptions: data.calendar_plan_options.filter((option) => idOf(option.customerId) === customerId),
      appointments: data.calendar_appointments.filter((appointment) => idOf(appointment.customerId) === customerId),
      paymentRequests: data.payment_requests.filter((payment) => idOf(payment.customerId) === customerId),
      qualificationHistory: data.lead_qualification_history.filter((entry) => idOf(entry.customerId) === customerId),
      issues: [],
    };
  });

  for (const conversation of conversations) {
    conversation.issues = issues.filter((issue) => issue.customerId === conversation.customerId);
  }

  const issueCounts = countBy(issues, (issue) => issue.severity);
  const modelStatistics = buildModelStatistics(data.ai_task_calls);
  const unlinkedRecords = {
    messages: resolvedMessages.filter((message) => !message.customerId).map((message) => message.record),
    modelCalls: data.ai_task_calls.filter((call) => !call.customerId),
    recordsWithUnknownCustomer: COLLECTIONS.flatMap((collectionName) => data[collectionName]
      .filter((record) => record.customerId && !customerById.has(idOf(record.customerId)))
      .map((record) => ({ collection: collectionName, record }))),
  };

  return {
    manifest: {
      generatedAt: new Date(),
      database: DATABASE_NAME,
      outputDirectory,
      readOnly: true,
      containsSensitiveData: true,
      collectionCounts: Object.fromEntries(COLLECTIONS.map((name) => [name, data[name].length])),
      conversationCount: conversations.length,
      models: modelStatistics,
    },
    analysis: {
      issueCounts,
      totalIssues: issues.length,
      issues: issues.sort(compareIssues),
    },
    conversations,
    unlinkedRecords,
  };
}

function buildModelStatistics(calls) {
  const models = groupBy(calls, (call) => call.model ?? "unknown");
  return [...models.entries()].map(([model, modelCalls]) => {
    const durations = modelCalls.map((call) => call.durationMs).filter(Number.isFinite).sort((a, b) => a - b);
    const usages = modelCalls.map(readUsage).filter(Boolean);
    return {
      model,
      calls: modelCalls.length,
      completed: modelCalls.filter((call) => call.status === "completed").length,
      failed: modelCalls.filter((call) => call.status === "failed").length,
      durationMs: {
        median: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
        maximum: durations.at(-1) ?? null,
      },
      tokens: {
        input: sum(usages.map((usage) => usage.inputTokens)),
        cachedInput: sum(usages.map((usage) => usage.cachedInputTokens)),
        output: sum(usages.map((usage) => usage.outputTokens)),
        reasoning: sum(usages.map((usage) => usage.reasoningTokens)),
        total: sum(usages.map((usage) => usage.totalTokens)),
      },
    };
  }).sort((first, second) => second.calls - first.calls);
}

function readUsage(call) {
  const usage = call.normalizedUsage ?? call.usage;
  if (!usage || typeof usage !== "object") return null;
  return {
    inputTokens: firstNumber(usage.inputTokens, usage.prompt_tokens, usage.input_tokens),
    cachedInputTokens: firstNumber(usage.cachedInputTokens, usage.prompt_tokens_details?.cached_tokens),
    outputTokens: firstNumber(usage.outputTokens, usage.completion_tokens, usage.output_tokens),
    reasoningTokens: firstNumber(usage.reasoningTokens, usage.completion_tokens_details?.reasoning_tokens),
    totalTokens: firstNumber(usage.totalTokens, usage.total_tokens),
  };
}

function renderAnalysis(audit) {
  const lines = [
    "# Oria conversation audit",
    "",
    `Generated: ${toIso(audit.manifest.generatedAt)}`,
    "",
    "> Sensitive local export. Delete this directory after completing the audit.",
    "",
    "## Scope",
    "",
    `- Conversations: ${audit.manifest.conversationCount}`,
    `- Messages: ${audit.manifest.collectionCounts.whatsapp_messages}`,
    `- Agent runs: ${audit.manifest.collectionCounts.assistant_runs}`,
    `- Model calls: ${audit.manifest.collectionCounts.ai_task_calls}`,
    `- Findings: ${audit.analysis.totalIssues}`,
    `- Errors: ${audit.analysis.issueCounts.error ?? 0}`,
    `- Warnings: ${audit.analysis.issueCounts.warning ?? 0}`,
    `- Informational: ${audit.analysis.issueCounts.info ?? 0}`,
    "",
    "## Model metadata",
    "",
    "| Model | Calls | Completed | Failed | Median ms | P95 ms | Input | Cached input | Output | Reasoning | Total |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ...audit.manifest.models.map((model) => `| ${model.model} | ${model.calls} | ${model.completed} | ${model.failed} | ${model.durationMs.median ?? "n/a"} | ${model.durationMs.p95 ?? "n/a"} | ${model.tokens.input} | ${model.tokens.cachedInput} | ${model.tokens.output} | ${model.tokens.reasoning} | ${model.tokens.total} |`),
    "",
    "## Findings",
    "",
  ];

  if (audit.analysis.issues.length === 0) lines.push("No structural or persisted runtime problems were detected.");
  for (const issue of audit.analysis.issues) {
    const references = [
      issue.customerId ? `customer=${issue.customerId}` : null,
      issue.runId ? `run=${issue.runId}` : null,
      issue.modelCallId ? `call=${issue.modelCallId}` : null,
      issue.iteration ? `iteration=${issue.iteration}` : null,
    ].filter(Boolean).join(", ");
    lines.push(`- **${issue.severity.toUpperCase()} ${issue.code}**: ${issue.message}${references ? ` (${references})` : ""}`);
  }

  lines.push("", "## Files", "", "- `raw/`: exact collection snapshots serialized as JSON.", "- `conversations/`: joined JSON and readable transcript per customer.", "- `unlinked-records.json`: records that could not be attached cleanly.", "- `analysis.json`: machine-readable findings.", "");
  return lines.join("\n");
}

function renderConversation(conversation) {
  const customerName = conversation.customer?.name ?? "Unknown customer";
  const lines = [
    `# Conversation ${conversation.index}: ${customerName}`,
    "",
    `- Customer ID: ${conversation.customerId}`,
    `- Service status: ${conversation.customer?.serviceStatus ?? "unknown"}`,
    `- Messages: ${conversation.messages.length}`,
    `- Agent runs: ${conversation.runs.length}`,
    `- Model calls: ${conversation.modelCalls.length}`,
    `- Findings: ${conversation.issues.length}`,
    "",
    "## Transcript",
    "",
  ];
  for (const message of conversation.messages) {
    lines.push(`### ${toIso(message.timestamp)} | ${message.direction} | ${message.status}`, "", String(message.body ?? ""), "");
  }
  lines.push("## Runs", "");
  for (const run of conversation.runs) {
    lines.push(`- ${toIso(run.startedAt)} | ${idOf(run._id)} | ${run.status} | iterations=${run.modelIterations} tools=${run.toolExecutions} mutations=${run.mutationsExecuted}${run.error ? ` | ${run.error}` : ""}`);
  }
  lines.push("", "## Findings", "");
  if (conversation.issues.length === 0) lines.push("No persisted structural/runtime findings for this conversation.");
  for (const issue of conversation.issues) lines.push(`- **${issue.severity.toUpperCase()} ${issue.code}**: ${issue.message}`);
  lines.push("");
  return lines.join("\n");
}

function resolveCustomerId(message, customerById, customerByPhone) {
  if (message.customerId) return idOf(message.customerId);
  return idOf(customerByPhone.get(normalizePhone(message.contactPhone))?._id) || null;
}

function extractToolResults(step) {
  const result = step.toolResult?.result;
  if (Array.isArray(result?.results)) return result.results;
  if (result && typeof result === "object") return [result];
  return [];
}

function addIssue(issues, severity, code, message, details = {}) {
  issues.push({ severity, code, message, ...details });
}

function compareIssues(first, second) {
  const rank = { error: 0, warning: 1, info: 2 };
  return rank[first.severity] - rank[second.severity] || first.code.localeCompare(second.code);
}

function groupBy(values, keyOf) {
  const groups = new Map();
  for (const value of values) {
    const key = keyOf(value);
    const group = groups.get(key) ?? [];
    group.push(value);
    groups.set(key, group);
  }
  return groups;
}

function countBy(values, keyOf) {
  const counts = {};
  for (const value of values) {
    const key = keyOf(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function findDuplicates(values, keyOf) {
  return [...groupBy(values, keyOf)].filter(([, group]) => group.length > 1).map(([key, group]) => ({ key, count: group.length }));
}

function byDate(field) {
  return (first, second) => new Date(first[field] ?? 0).getTime() - new Date(second[field] ?? 0).getTime();
}

function firstNumber(...values) {
  return values.find((value) => typeof value === "number" && Number.isFinite(value)) ?? 0;
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) return null;
  return sortedValues[Math.ceil(sortedValues.length * ratio) - 1];
}

function normalizePhone(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function idOf(value) {
  if (!value) return "";
  return value instanceof ObjectId ? value.toHexString() : String(value);
}

function safeFileName(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value ?? "") : date.toISOString();
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}