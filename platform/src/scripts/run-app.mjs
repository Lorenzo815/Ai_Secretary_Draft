import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start" && mode !== "standalone") {
  console.error("Usage: node src/scripts/run-app.mjs <dev|start|standalone>");
  process.exit(1);
}

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(scriptDirectory, "../..");
const nextBin = resolve(appRoot, "node_modules/next/dist/bin/next");
const workerScript = resolve(scriptDirectory, "assistant-worker.mjs");
const workerEnabled = (process.env.ASSISTANT_WORKER_ENABLED ?? "true").toLowerCase() === "true";
const children = [];
let shuttingDown = false;

if (mode === "standalone") {
  // Container runtimes set HOSTNAME to the container name; bind to all interfaces instead.
  process.env.HOSTNAME = process.env.BIND_HOSTNAME ?? "0.0.0.0";
  process.env.PORT ??= "3000";
  process.env.ASSISTANT_WORKER_URL ??= `http://127.0.0.1:${process.env.PORT}`;
}

const nextProcess = mode === "standalone"
  ? startChild("Next.js", [resolve(appRoot, "server.js")])
  : startChild("Next.js", [nextBin, mode]);
if (workerEnabled) {
  startChild("assistant worker", [workerScript]);
} else {
  console.log("Assistant worker disabled by ASSISTANT_WORKER_ENABLED.");
}

function startChild(name, args) {
  const child = spawn(process.execPath, args, {
    cwd: appRoot,
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