import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { CALENDAR_SCOPE, forgetGoogleToken, googleAccessToken, parseServiceAccount, resetGoogleTokenCache, SHEETS_SCOPE, signAssertion } from "./google-auth.ts";

const realFetch = globalThis.fetch;
const realLog = console.log;
let key = "";
let tokenCalls: URLSearchParams[] = [];

const toPem = (der: ArrayBuffer): string => `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;
const claimsOf = (assertion: string): Record<string, unknown> => JSON.parse(Buffer.from(assertion.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;

beforeEach(async () => {
  tokenCalls = [];
  resetGoogleTokenCache();
  console.log = () => {};
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  key = JSON.stringify({ client_email: "writer@test.iam.gserviceaccount.com", private_key: toPem((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer) });
  globalThis.fetch = (async (_input: RequestInfo | URL, init: RequestInit = {}) => {
    tokenCalls.push(new URLSearchParams(String(init.body)));
    return Response.json({ access_token: `token-${tokenCalls.length}`, expires_in: 3600 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

test("the assertion carries the scope it was asked for", async () => {
  const account = parseServiceAccount(key);
  assert.ok(account);
  const jwt = await signAssertion(account, 1_700_000_000, CALENDAR_SCOPE);
  const claims = claimsOf(jwt);
  assert.equal(claims.scope, CALENDAR_SCOPE);
  assert.equal(claims.iss, "writer@test.iam.gserviceaccount.com");
  assert.equal(claims.exp, 1_700_003_600);
});

test("tokens are cached per scope", async () => {
  assert.equal(await googleAccessToken(key, SHEETS_SCOPE), "token-1");
  assert.equal(await googleAccessToken(key, SHEETS_SCOPE), "token-1");
  assert.equal(await googleAccessToken(key, CALENDAR_SCOPE), "token-2");
  assert.equal(tokenCalls.length, 2);
  assert.equal(claimsOf(tokenCalls[1]?.get("assertion") ?? "").scope, CALENDAR_SCOPE);
});

test("forgetting one scope leaves the other cached", async () => {
  await googleAccessToken(key, SHEETS_SCOPE);
  await googleAccessToken(key, CALENDAR_SCOPE);
  forgetGoogleToken(CALENDAR_SCOPE);
  assert.equal(await googleAccessToken(key, SHEETS_SCOPE), "token-1");
  assert.equal(await googleAccessToken(key, CALENDAR_SCOPE), "token-3");
  forgetGoogleToken();
  assert.equal(await googleAccessToken(key, SHEETS_SCOPE), "token-4");
});

test("a missing or invalid key gives null without calling Google", async () => {
  assert.equal(await googleAccessToken(undefined, SHEETS_SCOPE), null);
  assert.equal(await googleAccessToken("not json", SHEETS_SCOPE), null);
  assert.equal(tokenCalls.length, 0);
});

test("a refusal from Google gives null and is not cached", async () => {
  globalThis.fetch = (async () => new Response("{}", { status: 400 })) as typeof fetch;
  assert.equal(await googleAccessToken(key, SHEETS_SCOPE), null);
});
