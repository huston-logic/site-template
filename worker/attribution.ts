/**
 * Lead source (docs/superpowers/specs/2026-11-27-ad-tracking-design.md, "Source capture" and "Delivery"). The one place
 * that builds, parses, cleans and summarises the first-party `hl_src` cookie, for the contact form, every owner-made form
 * and later features. The cookie comes from the visitor's browser, so everything read from it is outside text: it is
 * cleaned field by field (allow-listed keys, types, caps, no control characters), and nothing here ever throws. Anything
 * that does not parse or fails a rule is dropped, and a submission goes on without a source.
 * Import-free except for the standard library, so it stays inside the Worker's import rules.
 */

export const COOKIE_NAME = "hl_src";
const COOKIE_MAX_AGE = 7_776_000;
const DAY = 86_400;
/** A touch older than this is dropped (the cookie's own lifetime). */
const MAX_AGE_SECONDS = 90 * DAY;
/** A touch this far ahead of the Worker's clock is forged or broken. */
const MAX_FUTURE_SECONDS = DAY;
/** The most characters the encoded cookie value may have. */
export const COOKIE_VALUE_BUDGET = 3600;
const MAX_RAW_COOKIE_VALUE = 4096;

const TEXT_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const CLICK_KEYS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid"] as const;
type TextKey = (typeof TEXT_KEYS)[number];
type ClickKey = (typeof CLICK_KEYS)[number];

/** One visit that was worth recording. `at` is Unix seconds. */
export type Touch = { at: number; path?: string; ref?: string } & { [K in TextKey | ClickKey]?: string };
export interface SourceState {
  /** The first touch. */
  f: Touch;
  /** The last tagged touch. */
  l?: Touch;
}
/** The cleaned state that readers (the Sheet, the email, the Pipeline post) use. */
export interface Attribution {
  first: Touch;
  last?: Touch;
}

type FieldKey = "path" | "ref" | TextKey | ClickKey;
const MAX_LENGTH: Record<FieldKey, number> = {
  path: 200,
  ref: 100,
  utm_source: 100,
  utm_medium: 100,
  utm_campaign: 100,
  utm_content: 100,
  utm_term: 100,
  gclid: 200,
  gbraid: 200,
  wbraid: 200,
  fbclid: 200,
  msclkid: 200,
};
/** The short keys the cookie JSON uses. */
const SHORT: Record<FieldKey, string> = {
  path: "p",
  ref: "r",
  utm_source: "us",
  utm_medium: "um",
  utm_campaign: "uc",
  utm_content: "un",
  utm_term: "ut",
  gclid: "g",
  gbraid: "gb",
  wbraid: "wb",
  fbclid: "fb",
  msclkid: "ms",
};
const FIELD_KEYS = Object.keys(SHORT) as FieldKey[];
const CLICK_ID_PATTERN = /^[A-Za-z0-9._~-]+$/;

// ---------- cleaning ----------

/** Control and format characters (newlines, tabs, bidi marks, zero-width) are removed, then the text is trimmed and capped. */
function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "").trim().slice(0, max).trim();
  return text === "" ? undefined : text;
}

/** A click ID is kept whole or dropped: `[A-Za-z0-9._~-]` only, at most 200 characters. */
function cleanClickId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_LENGTH.gclid && CLICK_ID_PATTERN.test(value) ? value : undefined;
}

function cleanField(key: FieldKey, value: unknown): string | undefined {
  return (CLICK_KEYS as readonly string[]).includes(key) ? cleanClickId(value) : cleanText(value, MAX_LENGTH[key]);
}

function setField(touch: Touch, key: FieldKey, value: string | undefined): void {
  if (value !== undefined) touch[key] = value;
}

// ---------- touches ----------

const OWN_PLACEHOLDER_ORIGIN = "https://site.invalid";

function hostOf(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.hostname.toLowerCase() : null;
  } catch {
    return null;
  }
}

function sameSite(host: string, ownHost: string): boolean {
  const strip = (value: string) => value.toLowerCase().replace(/^www\./, "");
  return strip(host) === strip(ownHost);
}

/**
 * Builds a touch from what the page sent: a same-site path (query string allowed, only the tags are read from it) and the
 * referrer. Null when the path is not a same-site path starting with "/". Never throws.
 */
export function touchFromVisit(path: unknown, referrer: unknown, ownHost: string, nowSeconds: number): Touch | null {
  try {
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\") || path.length > 4096) return null;
    const url = new URL(path, OWN_PLACEHOLDER_ORIGIN);
    if (url.origin !== OWN_PLACEHOLDER_ORIGIN) return null;
    if (!Number.isFinite(nowSeconds)) return null;
    const touch: Touch = { at: Math.floor(nowSeconds) };
    setField(touch, "path", cleanText(decodeSafe(url.pathname), MAX_LENGTH.path));
    for (const key of [...TEXT_KEYS, ...CLICK_KEYS]) setField(touch, key, cleanField(key, url.searchParams.get(key)));
    if (typeof referrer === "string" && referrer !== "") {
      const host = hostOf(referrer);
      if (host && !sameSite(host, ownHost)) setField(touch, "ref", cleanText(host, MAX_LENGTH.ref));
    }
    return touch;
  } catch {
    return null;
  }
}

function decodeSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** A touch is tagged when it carries any `utm_*` value or click ID. */
export function isTagged(touch: Touch): boolean {
  return [...TEXT_KEYS, ...CLICK_KEYS].some((key) => touch[key] !== undefined);
}

function isFresh(touch: Touch, now: number): boolean {
  return touch.at <= now + MAX_FUTURE_SECONDS && now - touch.at <= MAX_AGE_SECONDS;
}

/** Drops touches older than 90 days or too far in the future; promotes `l` when `f` is gone. Null when nothing survives. */
export function freshState(state: SourceState, now: number): SourceState | null {
  const first = isFresh(state.f, now) ? state.f : null;
  const last = state.l && isFresh(state.l, now) ? state.l : null;
  if (first) return last ? { f: first, l: last } : { f: first };
  return last ? { f: last } : null;
}

/**
 * The cookie after one visit, or null when nothing changes (so no Set-Cookie). No state: the visit is the first touch.
 * A tagged visit becomes the last tagged touch; an untagged one changes nothing once a first touch exists.
 */
export function mergeVisit(state: SourceState | null, touch: Touch, now: number): SourceState | null {
  const current = state ? freshState(state, now) : null;
  if (!current) return { f: touch };
  if (!isTagged(touch)) return null;
  return { f: current.f, l: touch };
}

// ---------- the cookie value ----------

function toWire(touch: Touch): Record<string, string | number> {
  const wire: Record<string, string | number> = { a: touch.at };
  for (const key of FIELD_KEYS) {
    const value = touch[key];
    if (value !== undefined) wire[SHORT[key]] = value;
  }
  return wire;
}

function fromWire(raw: unknown): Touch | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const at = record["a"];
  if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return null;
  const touch: Touch = { at: Math.floor(at) };
  for (const key of FIELD_KEYS) setField(touch, key, cleanField(key, record[SHORT[key]]));
  return touch;
}

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  if (value.length === 0 || value.length > MAX_RAW_COOKIE_VALUE || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

function pack(state: SourceState): string {
  return toBase64Url(JSON.stringify({ f: toWire(state.f), ...(state.l ? { l: toWire(state.l) } : {}) }));
}

function slim(touch: Touch): Touch {
  const copy: Touch = { ...touch };
  delete copy.utm_content;
  delete copy.utm_term;
  let kept = false;
  for (const key of CLICK_KEYS) {
    if (copy[key] === undefined) continue;
    if (kept) delete copy[key];
    kept = true;
  }
  return copy;
}

function bare(touch: Touch): Touch {
  const copy = slim(touch);
  delete copy.path;
  delete copy.ref;
  return copy;
}

/**
 * The cookie value: base64url of compact JSON with short keys, at most 3,600 characters. Over the budget, `utm_content`,
 * `utm_term` and all but the first click ID go from each touch; then `f` goes (the last tagged touch stays); as a last
 * resort the landing path and referrer go too, which always fits.
 */
export function encodeState(state: SourceState): string {
  const slimmed: SourceState = state.l ? { f: slim(state.f), l: slim(state.l) } : { f: slim(state.f) };
  const stages: SourceState[] = [state, slimmed, state.l ? { f: slimmed.l ?? slimmed.f } : slimmed, state.l ? { f: bare(state.l) } : { f: bare(state.f) }];
  for (const stage of stages) {
    const value = pack(stage);
    if (value.length <= COOKIE_VALUE_BUDGET) return value;
  }
  return pack({ f: { at: state.l?.at ?? state.f.at } });
}

/**
 * Reads the cookie value back into a cleaned state: allow-listed keys, types and caps; extra keys ignored. Does not
 * apply the 90-day rule (see `freshState`). Null for anything that does not parse.
 */
export function decodeState(value: string): SourceState | null {
  try {
    const text = fromBase64Url(value);
    if (text === null) return null;
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const f = fromWire(record["f"]);
    const l = fromWire(record["l"]);
    if (f) return l ? { f, l } : { f };
    return l ? { f: l } : null;
  } catch {
    return null;
  }
}

/** The `Set-Cookie` header for a state: set by the Worker only, in an HTTP response. */
export function setCookieHeader(state: SourceState): string {
  return `${COOKIE_NAME}=${encodeState(state)}; Path=/; Max-Age=${COOKIE_MAX_AGE}; Secure; HttpOnly; SameSite=Lax`;
}

/** The raw value of our cookie in a `Cookie` header, or null. */
export function cookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

/** The cookie in a request, decoded, cleaned and age-checked. Never throws; null when absent, broken or expired. */
export function readState(cookieHeader: string | null, nowSeconds: number): SourceState | null {
  try {
    const value = cookieValue(cookieHeader);
    if (value === null) return null;
    const state = decodeState(value);
    return state ? freshState(state, nowSeconds) : null;
  } catch {
    return null;
  }
}

/** The cleaned attribution for a submission. Never throws; null when there is no usable cookie. */
export function readAttribution(cookieHeader: string | null, nowSeconds: number): Attribution | null {
  const state = readState(cookieHeader, nowSeconds);
  if (!state) return null;
  return state.l ? { first: state.f, last: state.l } : { first: state.f };
}

// ---------- outputs ----------

/** The touch the lead is credited to: the last tagged touch, else the first. */
function attributed(a: Attribution): Touch {
  return a.last ?? a.first;
}

function cap(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** One short, human line for the "Came from" cell, the email and the Pipeline `source`. At most 60 characters. */
export function sourceSummary(a: Attribution): string {
  const t = attributed(a);
  if (t.utm_source) return cap(t.utm_medium ? `${t.utm_source} / ${t.utm_medium}` : t.utm_source, 60);
  if (t.gclid || t.gbraid || t.wbraid) return "Google Ads";
  if (t.fbclid) return "Facebook or Instagram";
  if (t.msclkid) return "Microsoft Ads";
  if (t.ref) return cap(`Referral: ${t.ref}`, 60);
  return "Direct";
}

function clickIdText(t: Touch): string {
  for (const key of CLICK_KEYS) {
    const value = t[key];
    if (value !== undefined) return `${key}: ${value}`;
  }
  return "";
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function daysBetween(firstSeconds: number, receivedAtIso: string): number {
  const received = Date.parse(receivedAtIso);
  if (!Number.isFinite(received)) return 0;
  return Math.max(0, Math.floor((received - firstSeconds * 1000) / (DAY * 1000)));
}

/** Exactly five strings: Came from, Campaign, Click ID, First seen (UTC), Days to note. The Sheet writers apply the formula guard. */
export function sheetCells(a: Attribution | null, receivedAtIso: string): string[] {
  if (!a) return ["Not known", "", "", "", ""];
  const t = attributed(a);
  return [sourceSummary(a), t.utm_campaign ?? "", clickIdText(t), isoDate(a.first.at), String(daysBetween(a.first.at, receivedAtIso))];
}

/** The one line for the notification email. No line break can appear in it. */
export function emailLine(a: Attribution | null, receivedAtIso: string): string {
  if (!a) return "Came from: not known";
  const t = attributed(a);
  const days = daysBetween(a.first.at, receivedAtIso);
  const when = days === 0 ? "same day as this note" : `${days} ${days === 1 ? "day" : "days"} before this note`;
  const line = `Came from: ${sourceSummary(a)}${t.utm_campaign ? `, campaign ${t.utm_campaign}` : ""}, first visit ${isoDate(a.first.at)} (${when})`;
  return line.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, " ");
}

/** A touch with readable keys and an ISO time, for the Pipeline post. */
function readable(touch: Touch): Record<string, string> {
  const out: Record<string, string> = { at: new Date(touch.at * 1000).toISOString() };
  if (touch.path !== undefined) out.landing_path = touch.path;
  if (touch.ref !== undefined) out.referrer_host = touch.ref;
  for (const key of [...TEXT_KEYS, ...CLICK_KEYS]) {
    const value = touch[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

export interface PipelineAttribution {
  first: Record<string, string>;
  last?: Record<string, string>;
  daysToNote: number;
}

export function pipelineAttribution(a: Attribution, receivedAtIso: string): PipelineAttribution {
  return {
    first: readable(a.first),
    ...(a.last ? { last: readable(a.last) } : {}),
    daysToNote: daysBetween(a.first.at, receivedAtIso),
  };
}

/** The extra Pipeline lead keys: `source` and `attribution`, or nothing at all without an attribution. */
export function leadSource(a: Attribution | null, receivedAtIso: string): { source?: string; attribution?: PipelineAttribution } {
  return a ? { source: sourceSummary(a), attribution: pipelineAttribution(a, receivedAtIso) } : {};
}
