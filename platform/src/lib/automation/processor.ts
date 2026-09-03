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
  if (job.process === "customer_agent") return processCustomerAgentJob(job);

  try {
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