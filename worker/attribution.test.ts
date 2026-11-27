// Unit tests for worker/attribution.ts: building touches, merging, the cookie value and its byte budget, cleaning forged
// cookies, and the four outputs (Sheet cells, email line, Pipeline object, summary). Pure functions, no network.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  COOKIE_VALUE_BUDGET,
  decodeState,
  emailLine,
  encodeState,
  isTagged,
  mergeVisit,
  pipelineAttribution,
  readAttribution,
  setCookieHeader,
  sheetCells,
  sourceSummary,
  touchFromVisit,
  type Attribution,
  type SourceState,
  type Touch,
} from "./attribution.ts";

const DAY = 86_400;
const NOW = Date.UTC(2026, 10, 27, 12, 0, 0) / 1000;
const HOST = "example.test";

function cookieOf(value: string): string {
  return `a=1; hl_src=${value}; b=2`;
}

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function wire(touch: Record<string, unknown>): string {
  return b64(JSON.stringify({ f: touch }));
}

describe("touchFromVisit", () => {
  test("reads the tags, the path without its query and an outside referrer host", () => {
    const touch = touchFromVisit("/pricing?utm_source=google&utm_medium=cpc&utm_campaign=spring-sale&gclid=Abc_123-x&other=1", "https://www.google.com/search?q=x", HOST, NOW);
    assert.deepEqual(touch, { at: NOW, path: "/pricing", ref: "www.google.com", utm_source: "google", utm_medium: "cpc", utm_campaign: "spring-sale", gclid: "Abc_123-x" });
  });

  test("a referrer from the site itself (or its www twin) is not recorded", () => {
    assert.equal(touchFromVisit("/", "https://example.test/about", HOST, NOW)?.ref, undefined);
    assert.equal(touchFromVisit("/", "https://www.example.test/about", HOST, NOW)?.ref, undefined);
    assert.equal(touchFromVisit("/", "not a url", HOST, NOW)?.ref, undefined);
    assert.equal(touchFromVisit("/", "javascript:alert(1)", HOST, NOW)?.ref, undefined);
  });

  test("anything but a same-site path is null", () => {
    for (const path of ["", "pricing", "//evil.example/x", "/\\evil.example", "https://evil.example/", 42, null, undefined]) {
      assert.equal(touchFromVisit(path, "", HOST, NOW), null, String(path));
    }
  });

  test("caps and cleans text, drops bad click IDs", () => {
    const touch = touchFromVisit(`/${"p".repeat(400)}?utm_source=${"s".repeat(300)}&utm_term=%0A%0Dbad%00%09term%20&gclid=${"g".repeat(201)}&fbclid=a%20b&msclkid=ok.1~2-3_`, `https://${"h".repeat(200)}.example/`, HOST, NOW);
    assert.ok(touch);
    assert.equal(touch.path?.length, 200);
    assert.equal(touch.utm_source?.length, 100);
    assert.equal(touch.utm_term, "badterm");
    assert.equal(touch.gclid, undefined);
    assert.equal(touch.fbclid, undefined);
    assert.equal(touch.msclkid, "ok.1~2-3_");
    assert.equal(touch.ref?.length, 100);
  });

  test("isTagged is true for any utm value or click ID only", () => {
    assert.equal(isTagged({ at: 1 }), false);
    assert.equal(isTagged({ at: 1, path: "/", ref: "x.test" }), false);
    assert.equal(isTagged({ at: 1, utm_term: "x" }), true);
    assert.equal(isTagged({ at: 1, msclkid: "x" }), true);
  });
});

describe("mergeVisit", () => {
  const first: Touch = { at: NOW - 10 * DAY, path: "/" };
  const tagged: Touch = { at: NOW, utm_source: "google", utm_medium: "cpc" };

  test("no state: a tagged or referred visit is the first touch; a bare visit records nothing", () => {
    assert.equal(mergeVisit(null, first, NOW), null);
    const referred: Touch = { ...first, ref: "news.test" };
    assert.deepEqual(mergeVisit(null, referred, NOW), { f: referred });
    assert.deepEqual(mergeVisit(null, tagged, NOW), { f: tagged });
  });

  test("a tagged touch becomes the last tagged touch and keeps f", () => {
    assert.deepEqual(mergeVisit({ f: first }, tagged, NOW), { f: first, l: tagged });
    const later: Touch = { at: NOW, gclid: "zzz" };
    assert.deepEqual(mergeVisit({ f: first, l: tagged }, later, NOW), { f: first, l: later });
  });

  test("an untagged touch with f present changes nothing", () => {
    assert.equal(mergeVisit({ f: first }, { at: NOW, ref: "news.test" }, NOW), null);
    assert.equal(mergeVisit({ f: first, l: tagged }, { at: NOW }, NOW), null);
  });

  test("an expired f is replaced by the oldest surviving touch", () => {
    const old: Touch = { at: NOW - 91 * DAY, utm_source: "old" };
    assert.deepEqual(mergeVisit({ f: old, l: { at: NOW - 5 * DAY, utm_source: "mid" } }, tagged, NOW), { f: { at: NOW - 5 * DAY, utm_source: "mid" }, l: tagged });
    assert.equal(mergeVisit({ f: old }, { at: NOW }, NOW), null);
    assert.deepEqual(mergeVisit({ f: old }, { at: NOW, ref: "news.test" }, NOW), { f: { at: NOW, ref: "news.test" } });
  });
});

describe("encodeState and decodeState", () => {
  const state: SourceState = {
    f: { at: NOW - 7 * DAY, path: "/", ref: "news.test" },
    l: { at: NOW, path: "/landing", utm_source: "google", utm_medium: "cpc", utm_campaign: "spring-sale", gclid: "Abc_123-x" },
  };

  test("round trips through base64url JSON with short keys", () => {
    const value = encodeState(state);
    assert.match(value, /^[A-Za-z0-9_-]+$/);
    assert.deepEqual(decodeState(value), state);
    assert.ok(Buffer.from(value, "base64url").toString("utf8").includes('"us":"google"'));
  });

  test("non-ASCII text survives", () => {
    const text: SourceState = { f: { at: NOW, utm_campaign: "café ☕ 春" } };
    assert.deepEqual(decodeState(encodeState(text)), text);
  });

  test("over the 3,600-byte budget: utm_content, utm_term and extra click IDs go first, then f", () => {
    const fat = (extra: Partial<Touch>): Touch => ({
      at: NOW,
      path: "/x".repeat(100),
      ref: "r".repeat(100),
      utm_source: "s".repeat(100),
      utm_medium: "m".repeat(100),
      utm_campaign: "c".repeat(100),
      utm_content: "n".repeat(100),
      utm_term: "t".repeat(100),
      gclid: "g".repeat(200),
      gbraid: "b".repeat(200),
      wbraid: "w".repeat(200),
      fbclid: "f".repeat(200),
      msclkid: "m".repeat(200),
      ...extra,
    });
    const both: SourceState = { f: fat({}), l: fat({ at: NOW + 1 }) };
    const value = encodeState(both);
    assert.ok(value.length <= COOKIE_VALUE_BUDGET, `${value.length}`);
    const decoded = decodeState(value);
    assert.ok(decoded);
    assert.equal(decoded.f.utm_content, undefined);
    assert.equal(decoded.f.utm_term, undefined);
    assert.equal(decoded.f.gclid, "g".repeat(200));
    assert.equal(decoded.f.gbraid, undefined);
    assert.equal(decoded.f.msclkid, undefined);
    const keepsBoth = encodeState({ f: fat({ gclid: "g".repeat(50) }), l: fat({ at: NOW + 1, gclid: "g".repeat(50) }) });
    assert.ok(keepsBoth.length <= COOKIE_VALUE_BUDGET);

    // Even slimmed, two touches full of 4-byte characters do not fit: f is dropped and the last tagged touch stays.
    const wide = (at: number): Touch => ({ at, path: "😀".repeat(100), ref: "😀".repeat(50), utm_source: "😀".repeat(50), utm_medium: "😀".repeat(50), utm_campaign: "😀".repeat(50), gclid: "g".repeat(200) });
    const dropped = encodeState({ f: wide(NOW - DAY), l: wide(NOW) });
    assert.ok(dropped.length <= COOKIE_VALUE_BUDGET, `${dropped.length}`);
    assert.equal(decodeState(dropped)?.f.at, NOW);
    assert.equal(decodeState(dropped)?.l, undefined);
  });

  test("a single worst-case touch still fits", () => {
    const wide: Touch = { at: NOW, path: "😀".repeat(200), ref: "😀".repeat(100), utm_source: "😀".repeat(100), utm_medium: "😀".repeat(100), utm_campaign: "😀".repeat(100), utm_content: "😀".repeat(100), utm_term: "😀".repeat(100), gclid: "g".repeat(200) };
    assert.ok(encodeState({ f: wide }).length <= COOKIE_VALUE_BUDGET);
  });

  test("forged values decode to null or are cleaned, never throw", () => {
    for (const value of ["", "!!!", "a", "%%%%", b64("not json"), b64("null"), b64("[]"), b64("42"), b64('"x"'), b64("{}"), b64('{"f":null}'), b64('{"f":{"a":"1"}}'), b64('{"f":{"a":-5}}'), b64('{"f":{"a":0}}')]) {
      assert.equal(decodeState(value), null, value);
    }
    assert.equal(decodeState("A".repeat(5000)), null);
  });

  test("extra keys, wrong types and bad values are dropped field by field", () => {
    const decoded = decodeState(
      wire({ a: NOW, us: ["google"], um: 5, uc: "  spring\nsale\t ", g: "bad id!", gb: "ok_1", x: "extra", __proto__: { polluted: 1 }, p: { nested: true }, r: "news.test" }),
    );
    assert.deepEqual(decoded, { f: { at: NOW, utm_campaign: "springsale", gbraid: "ok_1", ref: "news.test" } });
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
  });

  test("a good l with a broken f becomes f", () => {
    assert.deepEqual(decodeState(b64(JSON.stringify({ f: "no", l: { a: NOW, us: "x" } }))), { f: { at: NOW, utm_source: "x" } });
  });
});

describe("readAttribution", () => {
  const cookie = (state: SourceState) => cookieOf(encodeState(state));

  test("no cookie or no hl_src is null", () => {
    assert.equal(readAttribution(null, NOW), null);
    assert.equal(readAttribution("", NOW), null);
    assert.equal(readAttribution("a=1; b=2; hl_src_other=zz", NOW), null);
    assert.equal(readAttribution("hl_src", NOW), null);
  });

  test("returns first and last touch", () => {
    const f: Touch = { at: NOW - 7 * DAY, ref: "news.test" };
    const l: Touch = { at: NOW - DAY, utm_source: "google" };
    assert.deepEqual(readAttribution(cookie({ f, l }), NOW), { first: f, last: l });
    assert.deepEqual(readAttribution(cookie({ f }), NOW), { first: f });
  });

  test("drops touches over 90 days old, and promotes l when f expired", () => {
    const old: Touch = { at: NOW - 91 * DAY, utm_source: "old" };
    const recent: Touch = { at: NOW - 3 * DAY, utm_source: "recent" };
    assert.equal(readAttribution(cookie({ f: old }), NOW), null);
    assert.deepEqual(readAttribution(cookie({ f: old, l: recent }), NOW), { first: recent });
    assert.deepEqual(readAttribution(cookie({ f: recent, l: old }), NOW), { first: recent });
    assert.ok(readAttribution(cookie({ f: { at: NOW - 90 * DAY } }), NOW));
  });

  test("times more than one day in the future are dropped", () => {
    assert.equal(readAttribution(cookie({ f: { at: NOW + 2 * DAY, utm_source: "x" } }), NOW), null);
    assert.ok(readAttribution(cookie({ f: { at: NOW + DAY - 5, utm_source: "x" } }), NOW));
  });

  test("a 10 KB cookie, bad base64 and bad JSON never throw", () => {
    assert.equal(readAttribution(cookieOf("A".repeat(10_240)), NOW), null);
    assert.equal(readAttribution(`hl_src=${"x".repeat(10_240)}`, NOW), null);
    assert.equal(readAttribution("hl_src=%%%", NOW), null);
    assert.equal(readAttribution(cookieOf(b64("{broken")), NOW), null);
    assert.equal(readAttribution(`${"junk=1; ".repeat(2000)}hl_src=${encodeState({ f: { at: NOW } })}`, NOW)?.first.at, NOW);
  });

  test("formula text and line breaks are cleaned or kept harmless", () => {
    const a = readAttribution(cookieOf(wire({ a: NOW - DAY, us: "=HYPERLINK(\"http://evil.test\",\"x\")", um: "cpc\r\nBcc: evil@example.test", uc: "line1\u2028line2" })), NOW);
    assert.ok(a);
    assert.equal(a.first.utm_medium, "cpcBcc: evil@example.test");
    assert.equal(a.first.utm_campaign, "line1line2");
    const line = emailLine(a, new Date(NOW * 1000).toISOString());
    assert.ok(!/[\r\n\u2028\u2029]/.test(line));
    // The cell keeps the text as is; the Sheet writers' formula guard (safeCell) handles the leading "=".
    assert.equal(sheetCells(a, new Date(NOW * 1000).toISOString())[0]?.startsWith("=HYPERLINK"), true);
  });
});

describe("outputs", () => {
  const received = new Date(NOW * 1000).toISOString();
  const attr = (touch: Touch, first: Touch = { at: NOW - 7 * DAY, path: "/" }): Attribution => ({ first, last: touch });

  test("sourceSummary follows the design's order and stays within 60 characters", () => {
    assert.equal(sourceSummary(attr({ at: NOW, utm_source: "google", utm_medium: "cpc" })), "google / cpc");
    assert.equal(sourceSummary(attr({ at: NOW, utm_source: "newsletter" })), "newsletter");
    assert.equal(sourceSummary(attr({ at: NOW, gclid: "a" })), "Google Ads");
    assert.equal(sourceSummary(attr({ at: NOW, gbraid: "a" })), "Google Ads");
    assert.equal(sourceSummary(attr({ at: NOW, wbraid: "a" })), "Google Ads");
    assert.equal(sourceSummary(attr({ at: NOW, fbclid: "a" })), "Facebook or Instagram");
    assert.equal(sourceSummary(attr({ at: NOW, msclkid: "a" })), "Microsoft Ads");
    assert.equal(sourceSummary({ first: { at: NOW, ref: "news.test" } }), "Referral: news.test");
    assert.equal(sourceSummary({ first: { at: NOW } }), "Direct");
    assert.ok(sourceSummary(attr({ at: NOW, utm_source: "s".repeat(100), utm_medium: "m".repeat(100) })).length <= 60);
    assert.ok(sourceSummary({ first: { at: NOW, ref: "r".repeat(100) } }).length <= 60);
  });

  test("the attributed touch is the last tagged touch, else the first", () => {
    assert.equal(sourceSummary({ first: { at: NOW, utm_source: "first" }, last: { at: NOW, utm_source: "last" } }), "last");
    assert.equal(sourceSummary({ first: { at: NOW, utm_source: "first" } }), "first");
  });

  test("sheetCells is exactly five strings", () => {
    assert.deepEqual(sheetCells(null, received), ["Not known", "", "", "", ""]);
    assert.deepEqual(sheetCells(attr({ at: NOW, utm_source: "google", utm_medium: "cpc", utm_campaign: "spring-sale", gclid: "Abc_123-x" }), received), ["google / cpc", "spring-sale", "gclid: Abc_123-x", "2026-11-20", "7"]);
    assert.deepEqual(sheetCells({ first: { at: NOW, fbclid: "fb1", msclkid: "ms1" } }, received), ["Facebook or Instagram", "", "fbclid: fb1", "2026-11-27", "0"]);
    assert.equal(sheetCells(attr({ at: NOW }), "not a date")[4], "0");
  });

  test("emailLine is one line", () => {
    assert.equal(emailLine(null, received), "Came from: not known");
    assert.equal(
      emailLine(attr({ at: NOW, utm_source: "google", utm_medium: "cpc", utm_campaign: "spring-sale" }), received),
      "Came from: google / cpc, campaign spring-sale, first visit 2026-11-20 (7 days before this note)",
    );
    assert.equal(emailLine({ first: { at: NOW - DAY } }, received), "Came from: Direct, first visit 2026-11-26 (1 day before this note)");
    assert.equal(emailLine({ first: { at: NOW } }, received), "Came from: Direct, first visit 2026-11-27 (same day as this note)");
  });

  test("pipelineAttribution has readable keys and ISO times", () => {
    const out = pipelineAttribution(attr({ at: NOW, path: "/landing", utm_source: "google", utm_campaign: "spring-sale", gclid: "Abc_123-x" }, { at: NOW - 7 * DAY, path: "/", ref: "news.test" }), received);
    assert.deepEqual(out, {
      first: { at: "2026-11-20T12:00:00.000Z", landing_path: "/", referrer_host: "news.test" },
      last: { at: "2026-11-27T12:00:00.000Z", landing_path: "/landing", utm_source: "google", utm_campaign: "spring-sale", gclid: "Abc_123-x" },
      daysToNote: 7,
    });
    assert.equal("last" in pipelineAttribution({ first: { at: NOW } }, received), false);
  });
});

describe("setCookieHeader", () => {
  test("has the fixed attributes", () => {
    const header = setCookieHeader({ f: { at: NOW } });
    assert.match(header, /^hl_src=[A-Za-z0-9_-]+; Path=\/; Max-Age=7776000; Secure; HttpOnly; SameSite=Lax$/);
  });
});

test("a visit with no tag and no other site's referrer creates no cookie", () => {
  const now = 1_800_000_000;
  const hop = touchFromVisit("/about", "https://www.example.com/", "example.com", now);
  assert.ok(hop);
  assert.equal(mergeVisit(null, hop, now), null);
  const app = touchFromVisit("/", "android-app://com.example.app/", "example.com", now);
  assert.ok(app);
  assert.equal(mergeVisit(null, app, now), null);
});

test("a tag without utm_source or a click ID reads as a tagged link", () => {
  const now = 1_800_000_000;
  const medium = touchFromVisit("/?utm_medium=email&utm_campaign=winter", "", "example.com", now);
  assert.ok(medium);
  assert.equal(sourceSummary({ first: medium }), "Tagged link / email");
  const campaign = touchFromVisit("/?utm_campaign=winter", "", "example.com", now);
  assert.ok(campaign);
  assert.equal(sourceSummary({ first: campaign }), "Tagged link");
});
