// Access log for the production Next.js server, similar to `next dev` output:
//   [req] GET /dashboard/conversas 200 in 84ms
// Loaded with `node --import` by run-app.mjs. Query strings are dropped and IDs masked
// so no personal data (search terms, phone numbers) reaches the logs.
import http from "node:http";

const INSTALLED = Symbol.for("oria.requestLogger.installed");
const STATIC_FILE = /\.(?:js|mjs|css|map|svg|png|jpe?g|gif|ico|webp|avif|webmanifest|txt|woff2?|ttf)$/i;

export function normalizePath(url) {
  const path = String(url ?? "/").split(/[?#]/)[0] || "/";
  return path
    .split("/")
    .map((segment) => {
      if (/^[0-9a-f]{24}$/i.test(segment)) return ":id";
      if (/^wamid\./i.test(segment)) return ":id";
      if (/\d{5,}/.test(segment)) return ":n";
      return segment;
    })
    .join("/");
}

export function shouldLog(path, status) {
  if (path.startsWith("/_next/")) return false;
  if (STATIC_FILE.test(path)) return false;
  if (path === "/api/health" && status < 400) return false;
  return true;
}

/**
 * @param {{ method: string, path: string, status: number, durationMs: number, kind?: string, aborted?: boolean }} entry
 */
export function formatLine({ method, path, status, durationMs, kind, aborted }) {
  const suffix = kind ? ` (${kind})` : "";
  return aborted
    ? `[req] ${method} ${path} aborted after ${durationMs}ms${suffix}`
    : `[req] ${method} ${path} ${status} in ${durationMs}ms${suffix}`;
}

function requestKind(headers) {
  if (headers["next-action"]) return "action";
  if (headers.rsc === "1") return "rsc";
  return undefined;
}

export function install(log = (line) => console.log(line)) {
  const prototype = http.Server.prototype;
  if (prototype[INSTALLED]) return;
  prototype[INSTALLED] = true;
  const originalEmit = prototype.emit;
  prototype.emit = function emit(event, request, response) {
    if (event === "request" && request && response) track(request, response, log);
    return originalEmit.apply(this, arguments);
  };
}

function track(request, response, log) {
  const startedAt = process.hrtime.bigint();
  const method = request.method ?? "GET";
  const path = normalizePath(request.url);
  const kind = requestKind(request.headers ?? {});
  let done = false;
  const finish = (aborted) => {
    if (done) return;
    done = true;
    const status = response.statusCode;
    if (!shouldLog(path, status)) return;
    const durationMs = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    try {
      log(formatLine({ method, path, status, durationMs, kind, aborted }));
    } catch {
      // Logging must never break request handling.
    }
  };
  response.once("finish", () => finish(false));
  response.once("close", () => finish(!response.writableFinished));
}

if (process.env.ORIA_REQUEST_LOG === "on") install();
