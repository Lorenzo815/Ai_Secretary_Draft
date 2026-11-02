import http from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { formatLine, install, normalizePath, shouldLog } from "./request-logger.mjs";

describe("request logger", () => {
  it("drops query strings and masks identifiers", () => {
    expect(normalizePath("/api/customers?search=Maria%20Silva")).toBe("/api/customers");
    expect(normalizePath("/dashboard/clientes/6ae79f66e15ea8e6ed5a8719")).toBe("/dashboard/clientes/:id");
    expect(normalizePath("/api/whatsapp/media/wamid.HBgLNTUxMTk5")).toBe("/api/whatsapp/media/:id");
    expect(normalizePath("/api/postal-code/01310100")).toBe("/api/postal-code/:n");
    expect(normalizePath("/dashboard")).toBe("/dashboard");
  });

  it("skips static assets and healthy probes but keeps failures", () => {
    expect(shouldLog("/_next/static/chunks/main.js", 200)).toBe(false);
    expect(shouldLog("/icon.svg", 200)).toBe(false);
    expect(shouldLog("/api/health", 200)).toBe(false);
    expect(shouldLog("/api/health", 503)).toBe(true);
    expect(shouldLog("/api/webhooks/whatsapp", 200)).toBe(true);
    expect(shouldLog("/dashboard/conversas", 200)).toBe(true);
  });

  it("formats lines like the Next.js dev server", () => {
    expect(formatLine({ method: "GET", path: "/dashboard", status: 200, durationMs: 84 }))
      .toBe("[req] GET /dashboard 200 in 84ms");
    expect(formatLine({ method: "GET", path: "/dashboard", status: 200, durationMs: 12, kind: "rsc" }))
      .toBe("[req] GET /dashboard 200 in 12ms (rsc)");
    expect(formatLine({ method: "POST", path: "/api/calendar", status: 200, durationMs: 5, aborted: true }))
      .toBe("[req] POST /api/calendar aborted after 5ms");
  });

  it("logs real HTTP requests once installed", async () => {
    const lines: string[] = [];
    install((line: string) => lines.push(line));
    const server = http.createServer((request, response) => {
      response.statusCode = request.url?.startsWith("/missing") ? 404 : 200;
      response.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await fetch(`http://127.0.0.1:${port}/api/calendar?from=2026-11-01`, { method: "POST" });
      await fetch(`http://127.0.0.1:${port}/missing`, { headers: { RSC: "1" } });
      await fetch(`http://127.0.0.1:${port}/_next/static/app.js`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\[req\] POST \/api\/calendar 200 in \d+ms$/);
    expect(lines[1]).toMatch(/^\[req\] GET \/missing 404 in \d+ms \(rsc\)$/);
  });
});
