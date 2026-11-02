import { existsSync } from "node:fs";

if (existsSync(".env.local")) {
  process.loadEnvFile(".env.local");
}

const enabled = (process.env.ASSISTANT_WORKER_ENABLED ?? "true").toLowerCase() === "true";
const secret = process.env.ASSISTANT_WORKER_SECRET;
const baseUrl = process.env.ASSISTANT_WORKER_URL ?? process.env.NEXTAUTH_URL ?? "http://localhost:3000";
// Incoming messages are processed immediately by the webhook trigger; this loop only picks up
// scheduled work (follow-ups, qualification, retries), so a 10 s floor keeps database load low.
const intervalMs = readBoundedInteger("ASSISTANT_WORKER_INTERVAL_MS", 10_000, 10_000, 60_000);
const timeoutMs = readBoundedInteger("ASSISTANT_WORKER_REQUEST_TIMEOUT_MS", 210_000, 1_000, 300_000);
const processUrl = new URL("/api/internal/assistant/process", baseUrl);
const logEveryTick = (process.env.ASSISTANT_WORKER_LOG_TICKS ?? "false").toLowerCase() === "true";
const heartbeatMs = readBoundedInteger("ASSISTANT_WORKER_HEARTBEAT_MS", 300_000, 10_000, 3_600_000);
const stats = { ticks: 0, failed: 0, processed: 0, totalMs: 0 };

if (!enabled) {
  console.log("[worker] disabled by ASSISTANT_WORKER_ENABLED.");
  process.exit(0);
}
if (!secret) {
  console.error("[worker] ASSISTANT_WORKER_SECRET is required.");
  process.exit(1);
}

let stopped = false;
let nextExecution;
const heartbeat = setInterval(logHeartbeat, heartbeatMs);

console.log(`[worker] started: ${processUrl.origin}, interval ${intervalMs}ms, heartbeat every ${formatDuration(heartbeatMs)}${logEveryTick ? ", logging every tick" : ""}.`);
void execute();

async function execute() {
  const startedAt = Date.now();
  let summary = "failed";
  try {
    const response = await fetch(processUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const result = await response.text();
    if (!response.ok) {
      console.error(`[worker] request failed (${response.status}): ${result.slice(0, 500)}`);
    } else {
      const parsed = JSON.parse(result);
      const processed = Number(parsed.processed) || 0;
      const echoes = Number(parsed.echoesProcessed) || 0;
      const forwarding = Number(parsed.forwardingProcessed) || 0;
      stats.processed += processed;
      summary = `ok processed=${processed} echoes=${echoes} forwarding=${forwarding}`;
      if (processed > 0) {
        console.log(`[worker] processed ${processed} item(s).`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      error instanceof Error && error.name === "TimeoutError"
        ? `[worker] request exceeded ${timeoutMs}ms; the job remains protected by its lease.`
        : `[worker] execution failed: ${message}`,
    );
  } finally {
    const durationMs = Date.now() - startedAt;
    stats.ticks += 1;
    stats.totalMs += durationMs;
    if (summary === "failed") stats.failed += 1;
    if (logEveryTick) console.log(`[worker] tick ${summary} in ${durationMs}ms`);
    if (!stopped) nextExecution = setTimeout(execute, intervalMs);
  }
}

function logHeartbeat() {
  const average = stats.ticks > 0 ? Math.round(stats.totalMs / stats.ticks) : 0;
  console.log(`[worker] heartbeat: ${stats.ticks} tick(s), ${stats.failed} failed, ${stats.processed} item(s) processed, avg ${average}ms in the last ${formatDuration(heartbeatMs)}.`);
  Object.assign(stats, { ticks: 0, failed: 0, processed: 0, totalMs: 0 });
}

function formatDuration(milliseconds) {
  return milliseconds % 60_000 === 0 ? `${milliseconds / 60_000} min` : `${Math.round(milliseconds / 1_000)}s`;
}

function shutdown() {
  stopped = true;
  if (nextExecution) clearTimeout(nextExecution);
  clearInterval(heartbeat);
  console.log("[worker] stopped.");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

function readBoundedInteger(name, fallback, minimum, maximum) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}