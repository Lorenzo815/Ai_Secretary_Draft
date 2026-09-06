import "server-only";

import { getAssistantConfig } from "../assistant/config";
import { processCustomerAgentJob } from "../assistant/agent/orchestrator";
import { analyzeAndSaveCustomerLeadQualification } from "../qualification/customer-lead";
import {
  claimAutomationJob,
  completeAutomationJob,
  failAutomationJob,
} from "./queue";

export async function processNextAutomationJob() {
  const job = await claimAutomationJob(getAssistantConfig().leaseMs);
  if (!job) return { processed: false as const };
  if (job.process === "customer_agent" || job.process === "customer_follow_up") {
    return processCustomerAgentJob(job);
  }

  try {
    if (!isQualificationTrigger(job.event, job.eventPayload?.reason)) {
      await completeAutomationJob(job._id, job.revision);
      return { processed: true as const, process: job.process, skipped: "unsupported_qualification_trigger" };
    }
    const qualification = await analyzeAndSaveCustomerLeadQualification(job.customerId);
    await completeAutomationJob(job._id, job.revision);
    return {
      processed: true as const,
      process: job.process,
      qualificationGenerated: Boolean(qualification),
    };
  } catch (error) {
    await failAutomationJob(job, error);
    throw error;
  }
}

function isQualificationTrigger(event: string, reason: unknown) {
  return (
    (event === "assistant.response.sent" && reason === "follow_up")
    || (event === "customer.profile.updated" && reason === "profile_completed")
    || (event === "appointment.status.changed" && reason === "first_appointment_confirmed")
  );
}