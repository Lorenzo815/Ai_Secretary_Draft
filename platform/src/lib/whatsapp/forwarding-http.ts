import "server-only";

import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";
import type { ForwardingResult } from "./forwarding-contracts";

const TIMEOUT_MS = 8_000;
const blockedIpv4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15],
  ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedIpv4.addSubnet(address, prefix, "ipv4");
const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
const blockedIpv6 = new BlockList();
blockedIpv6.addSubnet("2001::", 23, "ipv6");
blockedIpv6.addSubnet("2001:db8::", 32, "ipv6");
blockedIpv6.addSubnet("2002::", 16, "ipv6");
blockedIpv6.addSubnet("3fff::", 20, "ipv6");

export class ForwardingAddressError extends Error {}

export function isPublicForwardingAddress(address: string) {
  if (isIP(address) === 4) return !blockedIpv4.check(address, "ipv4");
  return isIP(address) === 6 && globalIpv6.check(address, "ipv6") && !blockedIpv6.check(address, "ipv6");
}

export function forwardingUrl(value: string) {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new ForwardingAddressError("Informe uma URL HTTPS válida."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || (url.port && url.port !== "443")) {
    throw new ForwardingAddressError("Use HTTPS na porta 443, sem usuário, senha ou fragmento na URL.");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") ||
    hostname.endsWith(".internal") || (isIP(hostname) && !isPublicForwardingAddress(hostname))) {
    throw new ForwardingAddressError("O destino deve ser um endereço público da internet.");
  }
  const ownHosts = [
    process.env.NEXTAUTH_URL, process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ].filter((host): host is string => Boolean(host)).map(host => {
    try { return new URL(host.includes("://") ? host : `https://${host}`).hostname.toLowerCase().replace(/\.$/, ""); }
    catch { throw new ForwardingAddressError("A URL do próprio ambiente está configurada incorretamente."); }
  });
  if (ownHosts.includes(url.hostname.toLowerCase().replace(/\.$/, ""))) {
    throw new ForwardingAddressError("Não encaminhe eventos para o próprio ambiente da Oria.");
  }
  return url;
}

export async function sendForwardedWebhook(input: {
  url: string;
  body: Uint8Array;
  deliveryId: string;
  signature?: string;
  isTest: boolean;
}): Promise<ForwardingResult> {
  const started = Date.now();
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const url = forwardingUrl(input.url);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    let onAbort: () => void = () => undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
    });
    let addresses;
    try {
      addresses = await Promise.race([lookup(hostname, { all: true, verbatim: true }), aborted]);
    } finally { signal.removeEventListener("abort", onAbort); }
    if (!addresses.length || addresses.some(({ address }) => !isPublicForwardingAddress(address))) {
      throw new ForwardingAddressError("O DNS do destino deve apontar apenas para endereços públicos.");
    }
    // Connect to the validated IP, preserving TLS SNI and Host, without a second DNS lookup.
    const status = await new Promise<number>((resolve, reject) => {
      const outgoing = request({
        hostname: addresses[0].address,
        servername: hostname,
        port: 443,
        method: "POST",
        path: url.pathname + url.search,
        signal,
        headers: {
          Host: url.host,
          "Content-Type": "application/json",
          "Content-Length": input.body.byteLength,
          "X-Oria-Delivery-Id": input.deliveryId,
          "X-Oria-Webhook-Forwarded": "1",
          ...(input.signature ? { "X-Hub-Signature-256": input.signature } : {}),
          ...(input.isTest ? { "X-Oria-Webhook-Test": "1" } : {}),
        },
      }, response => {
        const code = response.statusCode;
        response.destroy();
        if (code === undefined) reject(new Error("HTTP status unavailable"));
        else resolve(code);
      });
      outgoing.on("error", reject);
      outgoing.end(input.body);
    });
    return { ok: status === 200, status, durationMs: Date.now() - started, error: status === 200 ? null : `O destino respondeu HTTP ${status}; esperado HTTP 200.` };
  } catch (error) {
    const reason = error instanceof ForwardingAddressError
      ? error.message
      : signal.aborted ? "O destino não respondeu em até 8 segundos." : "Falha de DNS, conexão ou certificado TLS do destino.";
    console.error("WhatsApp forwarding delivery failed.", { deliveryId: input.deliveryId, errorType: error instanceof Error ? error.name : "Unknown" });
    return { ok: false, status: null, durationMs: Date.now() - started, error: reason };
  }
}
