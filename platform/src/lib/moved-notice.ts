// Temporary: Oria now runs on Azure. While this is on, every screen of this deployment shows a notice
// with a link to the same screen at the new address. Webhooks and the worker (/api/*) keep working here.
// To turn it off: set ORIA_MOVED_NOTICE=off in Vercel and redeploy, use Vercel Instant Rollback,
// or revert the commit that added this file.
export const MOVED_TO_ORIGIN = "https://ca-oria.whiteisland-0f8ce503.brazilsouth.azurecontainerapps.io";
export const MOVED_NOTICE_PATH = "/mudamos";

export function movedNoticeEnabled() {
  return process.env.ORIA_MOVED_NOTICE !== "off";
}

/**
 * While on, every /api/* request (Meta and Mercado Pago webhooks, the integration webhook, the worker endpoint)
 * is passed through to Azure untouched, so this old deployment never runs its own code against the database.
 * Turn off with ORIA_API_PASSTHROUGH=off.
 */
export function apiPassthroughEnabled() {
  return process.env.ORIA_API_PASSTHROUGH !== "off";
}

/** The same screen at the new address; only same-site paths are accepted. */
export function movedTargetUrl(from: string | string[] | undefined) {
  const path = Array.isArray(from) ? from[0] : from;
  const safe = path && path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : "/dashboard";
  return `${MOVED_TO_ORIGIN}${safe === "/" ? "/dashboard" : safe}`;
}
