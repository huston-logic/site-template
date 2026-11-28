import { log, retryable, TIMEOUT_MS } from "./env.ts";
import { forgetGoogleToken, googleAccessToken, parseServiceAccount, resetGoogleTokenCache, SHEETS_SCOPE, signAssertion as signGoogleAssertion } from "./google-auth.ts";
import type { ServiceAccount } from "./google-auth.ts";

/**
 * The optional "service-account" Sheet writer (`contact.sheetWriter` in site.config.ts; the default is the Apps Script
 * writer in apps-script.ts). Appends one row to the owner's Google Sheet as a service account, with no library: the
 * OAuth JWT is signed with Web Crypto (RS256) and exchanged for an access token, then the row goes in through the
 * Sheets API.
 * https://developers.google.com/identity/protocols/oauth2/service-account
 */

/** A tab as A1 notation wants it: always in single quotes, a quote inside doubled (a tab with a space is not valid unquoted). */
export const a1Range = (tab: string, columns: string): string => `'${tab.replace(/'/g, "''")}'!${columns}`;

/** The signed JWT assertion for the Sheets scope. Exported for the tests. */
export const signAssertion = (account: ServiceAccount, now: number): Promise<string> => signGoogleAssertion(account, now, SHEETS_SCOPE);

const accessToken = (keyJson: string | undefined): Promise<string | null> => googleAccessToken(keyJson, SHEETS_SCOPE);

/**
 * Cells starting with = + - @ (or a tab or carriage return) could run as formulas if the sheet is later exported and
 * opened elsewhere, so they get a leading apostrophe (OWASP CSV injection guidance). RAW input already stops Sheets
 * itself from parsing them.
 */
export function safeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Whether `value` is already in the given column of the tab (0 is column A). True means it is; false means it is not;
 * null means the Sheet could not be read, so the caller must not append blindly. Used to add a gift card row once.
 */
async function columnHas(token: string, sheetId: string, tab: string, column: number, value: string): Promise<boolean | null> {
  const letter = String.fromCharCode(65 + column);
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(a1Range(tab, `${letter}:${letter}`))}?majorDimension=COLUMNS`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.ok) {
        const data = (await response.json().catch(() => null)) as { values?: unknown } | null;
        const first = Array.isArray(data?.values) ? (data.values as unknown[])[0] : undefined;
        return Array.isArray(first) && first.some((cell) => cell === value);
      }
      log("sheet_read_failed", { status: response.status, attempt });
      if (!retryable(response.status)) return null;
    } catch {
      log("sheet_unreachable", { attempt });
    }
  }
  return null;
}

/**
 * Appends `row` to the given tab. Retries once on a rate limit, server error, expired token or network failure.
 * With `onceColumn` (a 0-based column index) the row is added only if its value in that column is not already there, so a
 * gift card sold once is never listed twice; "already there" counts as saved.
 */
export async function appendRow(keyJson: string | undefined, sheetId: string | undefined, tab: string, row: string[], onceColumn?: number): Promise<boolean> {
  const account = keyJson ? parseServiceAccount(keyJson) : null;
  if (!account || !sheetId) {
    log("sheet_config_missing");
    return false;
  }
  if (onceColumn !== undefined) {
    const token = await accessToken(keyJson);
    if (!token) return false;
    const present = await columnHas(token, sheetId, tab, onceColumn, row[onceColumn] ?? "");
    if (present === null) return false;
    if (present) return true;
  }
  const range = encodeURIComponent(a1Range(tab, "A:T"));
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const body = JSON.stringify({ values: [row.map(safeCell)] });
  for (let attempt = 1; attempt <= 2; attempt++) {
    const token = await accessToken(keyJson);
    if (!token) return false;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return true;
      log("sheet_append_failed", { status: response.status, attempt });
      if (response.status === 401) forgetGoogleToken(SHEETS_SCOPE);
      else if (!retryable(response.status)) return false;
    } catch {
      log("sheet_unreachable", { attempt });
    }
  }
  return false;
}

/** Test helper: forget the cached access token. */
export function resetTokenCache(): void {
  resetGoogleTokenCache();
}
