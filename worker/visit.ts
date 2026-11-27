import { cookieValue, decodeState, freshState, mergeVisit, setCookieHeader, touchFromVisit } from "./attribution.ts";
import { log } from "./env.ts";
import { BASE_HEADERS, jsonResponse } from "./http.ts";
import { readBody } from "./read-body.ts";

/**
 * POST /api/visit (ad tracking design, "Source capture"). The page's inline capture script posts `{ path, referrer }` only
 * when the visit carries ad tags or comes from another site. The answer is always 204; it carries a Set-Cookie for the
 * first-party `hl_src` cookie only when the visit changed it. Nothing is stored or sent anywhere, so there is no rate
 * limit (ruling 13). Logs hold fixed event names only, never a value.
 */

const MAX_BODY_BYTES = 2048;
const CSP = { "content-security-policy": "default-src 'none'; frame-ancestors 'none'" };

function reject(status: number, error: string, extra: Record<string, string> = {}): Response {
  return jsonResponse(status, { error }, { ...CSP, ...extra });
}

export async function handleVisit(request: Request, url: URL): Promise<Response> {
  if (request.method !== "POST") return reject(405, "method_not_allowed", { allow: "POST" });

  // Same checks as the forms: only the site's own pages may post here.
  const fetchSite = request.headers.get("sec-fetch-site");
  if (request.headers.get("origin") !== url.origin || (fetchSite !== null && fetchSite !== "same-origin")) {
    log("visit_rejected_origin");
    return reject(403, "rejected");
  }
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return reject(415, "rejected");
  if (Number(request.headers.get("content-length") ?? "0") > MAX_BODY_BYTES) return reject(413, "rejected");
  const text = await readBody(request, MAX_BODY_BYTES);
  if (text === null) return reject(413, "rejected");

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return reject(400, "rejected");
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return reject(400, "rejected");
  const body = data as Record<string, unknown>;
  const { path, referrer } = body;
  if (Object.keys(body).some((key) => key !== "path" && key !== "referrer") || typeof path !== "string" || typeof referrer !== "string") {
    return reject(400, "rejected");
  }

  const now = Math.floor(Date.now() / 1000);
  const touch = touchFromVisit(path, referrer, url.hostname, now);
  if (!touch) return reject(400, "rejected");

  const existing = cookieValue(request.headers.get("cookie"));
  const decoded = existing === null ? null : decodeState(existing);
  const state = decoded ? freshState(decoded, now) : null;
  const next = mergeVisit(state, touch, now);

  const headers: Record<string, string> = { ...BASE_HEADERS, ...CSP };
  if (next) headers["set-cookie"] = setCookieHeader(next);
  log(next ? "visit_recorded" : "visit_unchanged");
  return new Response(null, { status: 204, headers });
}
