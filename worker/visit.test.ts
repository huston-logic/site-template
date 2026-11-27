// Tests for POST /api/visit (worker/visit.ts), through the Worker built from a fixture config. No network is used.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { COOKIE_NAME, decodeState } from "./attribution.ts";
import { buildWorkerConfig, type WorkerSiteConfig } from "./config.ts";
import { createWorker } from "./contact.ts";
import type { ContactEnv } from "./env.ts";

const FIXTURE: WorkerSiteConfig = {
  business: { name: "Example Co", tagline: "Plain words for plain work" },
  owner: { name: "Pat Example", role: "Founder" },
  domain: { url: "https://example.test", workerName: "example-site", previewHostSuffix: ".workers.dev" },
  contact: {
    siteEmail: "hello@example.test",
    fromName: "Example Co",
    replyFromName: "Pat Example",
    schedulerUrl: "https://example.test/book",
    sheetWriter: "apps-script",
    sheetTabs: { production: "Submissions", preview: "Preview" },
    emailColors: { green: "#112233", ink: "#223344", ink2: "#334455", rust: "#445566", line: "#556677" },
  },
};
const worker = createWorker(buildWorkerConfig(FIXTURE));
const ORIGIN = "https://example.test";
const env: ContactEnv = { SITE_ENV: "production" };
const TAGGED = "/?utm_source=google&utm_medium=cpc&utm_campaign=spring-sale&gclid=Abc_123-x";

let logs: string[] = [];
let fetched = 0;
const realLog = console.log;
const realFetch = globalThis.fetch;

beforeEach(() => {
  logs = [];
  fetched = 0;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  globalThis.fetch = (async () => {
    fetched++;
    throw new Error("the visit endpoint must not call out");
  }) as typeof fetch;
});

afterEach(() => {
  console.log = realLog;
  globalThis.fetch = realFetch;
  assert.equal(fetched, 0);
  for (const line of logs) {
    assert.match(line, /^\{"event":"visit_(recorded|unchanged|rejected_origin)"\}$/, line);
  }
});

function visit(body: unknown, { origin = ORIGIN, contentType = "application/json", cookie, raw, site = "same-origin" }: { origin?: string | null; contentType?: string; cookie?: string; raw?: string; site?: string | null } = {}): Request {
  const headers: Record<string, string> = { "content-type": contentType };
  if (origin !== null) headers.origin = origin;
  if (site !== null) headers["sec-fetch-site"] = site;
  if (cookie) headers.cookie = cookie;
  return new Request(`${ORIGIN}/api/visit`, { method: "POST", headers, body: raw ?? JSON.stringify(body) });
}

function cookieFrom(response: Response): string | null {
  const header = response.headers.get("set-cookie");
  return header ? (header.split(";")[0]?.slice(COOKIE_NAME.length + 1) ?? null) : null;
}

describe("POST /api/visit", () => {
  test("a tagged visit answers 204 with the cookie and the Worker's headers", async () => {
    const response = await worker.fetch(visit({ path: TAGGED, referrer: "https://www.google.com/" }), env);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; frame-ancestors 'none'");
    assert.match(response.headers.get("set-cookie") ?? "", /^hl_src=[A-Za-z0-9_-]+; Path=\/; Max-Age=7776000; Secure; HttpOnly; SameSite=Lax$/);
    const state = decodeState(cookieFrom(response) ?? "");
    assert.equal(state?.f.utm_campaign, "spring-sale");
    assert.equal(state?.f.gclid, "Abc_123-x");
    assert.equal(state?.f.ref, "www.google.com");
    assert.equal(state?.f.path, "/");
  });

  test("an untagged visit with a cookie already set changes nothing", async () => {
    const first = await worker.fetch(visit({ path: TAGGED, referrer: "" }), env);
    const cookie = `${COOKIE_NAME}=${cookieFrom(first)}`;
    const again = await worker.fetch(visit({ path: "/about", referrer: "https://news.test/post" }, { cookie }), env);
    assert.equal(again.status, 204);
    assert.equal(again.headers.get("set-cookie"), null);
  });

  test("a later tagged visit keeps f and replaces l", async () => {
    const first = await worker.fetch(visit({ path: "/?utm_source=a", referrer: "" }), env);
    const cookie = `${COOKIE_NAME}=${cookieFrom(first)}`;
    const second = await worker.fetch(visit({ path: "/?utm_source=b", referrer: "" }, { cookie }), env);
    const state = decodeState(cookieFrom(second) ?? "");
    assert.equal(state?.f.utm_source, "a");
    assert.equal(state?.l?.utm_source, "b");
  });

  test("a forged cookie is replaced, not trusted", async () => {
    const response = await worker.fetch(visit({ path: TAGGED, referrer: "" }, { cookie: `${COOKIE_NAME}=${"A".repeat(10_000)}` }), env);
    assert.equal(response.status, 204);
    assert.equal(decodeState(cookieFrom(response) ?? "")?.f.utm_source, "google");
  });

  test("other methods are 405 with Allow: POST", async () => {
    const response = await worker.fetch(new Request(`${ORIGIN}/api/visit`), env);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "POST");
  });

  const bad: [string, () => Request, number][] = [
    ["another origin", () => visit({ path: "/", referrer: "" }, { origin: "https://evil.example" }), 403],
    ["no origin", () => visit({ path: "/", referrer: "" }, { origin: null }), 403],
    ["a cross-site fetch", () => visit({ path: "/", referrer: "" }, { site: "cross-site" }), 403],
    ["form-encoded content", () => visit({ path: "/", referrer: "" }, { contentType: "application/x-www-form-urlencoded" }), 415],
    ["a body over 8 KB", () => visit({ path: `/${"x".repeat(8300)}`, referrer: "" }), 413],
    ["broken JSON", () => visit(null, { raw: "{" }), 400],
    ["an array", () => visit([]), 400],
    ["null", () => visit(null), 400],
    ["an extra key", () => visit({ path: "/", referrer: "", extra: "1" }), 400],
    ["a missing referrer", () => visit({ path: "/" }), 400],
    ["a number for the path", () => visit({ path: 5, referrer: "" }), 400],
    ["a path that is not same-site", () => visit({ path: "//evil.example/", referrer: "" }), 400],
    ["a path without a slash", () => visit({ path: "pricing", referrer: "" }), 400],
  ];
  for (const [label, request, status] of bad) {
    test(`${label} is ${status}`, async () => {
      const response = await worker.fetch(request(), env);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("set-cookie"), null);
    });
  }

  test("a chunked body over 8 KB without a length is refused", async () => {
    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ path: `/${"x".repeat(9000)}`, referrer: "" })));
          controller.close();
        },
      }),
      duplex: "half",
    };
    const big = new Request(`${ORIGIN}/api/visit`, init);
    assert.equal((await worker.fetch(big, env)).status, 413);
  });
});
