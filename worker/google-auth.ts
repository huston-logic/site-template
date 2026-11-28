import { log, TIMEOUT_MS } from "./env.ts";

/**
 * Google service-account sign-in shared by the Sheet writer and the booking calendar, with no library: the OAuth JWT is
 * signed with Web Crypto (RS256) and exchanged for an access token, cached per account and scope.
 * https://developers.google.com/identity/protocols/oauth2/service-account
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy";

export type ServiceAccount = { client_email: string; private_key: string };

const cache = new Map<string, { value: string; expiresAt: number }>();

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlJson(value: object): string {
  return base64url(new TextEncoder().encode(JSON.stringify(value)));
}

export function parseServiceAccount(json: string): ServiceAccount | null {
  try {
    const data = JSON.parse(json) as Partial<ServiceAccount>;
    if (typeof data.client_email === "string" && typeof data.private_key === "string") {
      return { client_email: data.client_email, private_key: data.private_key };
    }
  } catch {
    // Falls through to null; the caller logs a fixed event, never the value.
  }
  return null;
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** The signed JWT assertion for the token exchange. `now` is Unix seconds. */
export async function signAssertion(account: ServiceAccount, now: number, scope: string): Promise<string> {
  const header = base64urlJson({ alg: "RS256", typ: "JWT" });
  const claims = base64urlJson({ iss: account.client_email, scope, aud: TOKEN_URL, iat: now, exp: now + 3600 });
  const key = await importPrivateKey(account.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
}

/** An access token for the scope, or null when the key is missing or invalid or Google refuses. Refreshed 60 s before it expires. */
export async function googleAccessToken(keyJson: string | undefined, scope: string): Promise<string | null> {
  const account = keyJson ? parseServiceAccount(keyJson) : null;
  if (!account) return null;
  const cacheKey = `${account.client_email}\n${scope}`;
  const now = Math.floor(Date.now() / 1000);
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now + 60) return cached.value;
  try {
    const assertion = await signAssertion(account, now, scope);
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      log("google_token_failed", { status: response.status });
      return null;
    }
    const data = (await response.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof data.access_token !== "string") return null;
    const lifetime = typeof data.expires_in === "number" ? data.expires_in : 3600;
    cache.set(cacheKey, { value: data.access_token, expiresAt: now + lifetime });
    return data.access_token;
  } catch {
    log("google_token_unreachable");
    return null;
  }
}

/** Drops cached tokens (those for one scope, or all), so the next call signs in again. Used after a 401. */
export function forgetGoogleToken(scope?: string): void {
  if (scope === undefined) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) if (key.endsWith(`\n${scope}`)) cache.delete(key);
}

/** Test helper: forget every cached token. */
export function resetGoogleTokenCache(): void {
  cache.clear();
}
