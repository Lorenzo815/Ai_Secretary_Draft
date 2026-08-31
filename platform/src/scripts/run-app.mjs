import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: node src/scripts/run-app.mjs <dev|start>");
  process.exit(1);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const nextBin = resolve(scriptDirectory, "../../node_modules/next/dist/bin/next");
const workerScript = resolve(scriptDirectory, "assistant-worker.mjs");
const workerEnabled = (process.env.ASSISTANT_WORKER_ENABLED ?? "true").toLowerCase() === "true";
const children = [];
let shuttingDown = false;

const nextProcess = startChild("Next.js", [nextBin, mode]);
if (workerEnabled) {
  startChild("assistant worker", [workerScript]);
} else {
  console.log("Assistant worker disabled by ASSISTANT_WORKER_ENABLED.");
}

function startChild(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: resolve(scriptDirectory, "../.."),
    env: process.env,
    stdio: "inherit",
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(`Failed to start ${name}:`, error.message);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`${name} stopped unexpectedly with ${detail}.`);
    shutdown(code && code !== 0 ? code : 1);
  });
  return child;
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  process.exitCode = exitCode;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

nextProcess.on("exit", () => {
  if (shuttingDown) process.exit();
});