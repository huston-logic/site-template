import { jsonResponse } from "../http.ts";

const CSP = { "content-security-policy": "default-src 'none'; frame-ancestors 'none'" };

/** Every payments route answers JSON with the same locked-down headers as the form routes. */
export function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return jsonResponse(status, body, { ...CSP, ...extra });
}
