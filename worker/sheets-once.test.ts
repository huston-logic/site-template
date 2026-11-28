// The service-account writer adds a gift card row only if its code is not already in column B (design R6).
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { appendRow, resetTokenCache } from "./sheets.ts";

let calls: { method: string; url: string }[] = [];
let column: unknown[] = [];
let readStatus = 200;
let key = "";
const realFetch = globalThis.fetch;
const realLog = console.log;

const toPem = (der: ArrayBuffer): string => `-----BEGIN PRIVATE KEY-----\n${Buffer.from(der).toString("base64").replace(/(.{64})/g, "$1\n")}\n-----END PRIVATE KEY-----\n`;

beforeEach(async () => {
  calls = [];
  column = [];
  readStatus = 200;
  resetTokenCache();
  console.log = () => {};
  const pair = (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  key = JSON.stringify({ client_email: "writer@test.iam.gserviceaccount.com", private_key: toPem((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer) });
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ method: init.method ?? "GET", url });
    if (url.startsWith("https://oauth2.googleapis.com/token")) return Response.json({ access_token: "token-1", expires_in: 3600 });
    if (url.includes(":append")) return Response.json({ ok: true });
    return readStatus === 200 ? Response.json({ values: [column] }) : new Response("{}", { status: readStatus });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

const appends = () => calls.filter((call) => call.url.includes(":append")).length;
const ROW = ["2026-11-27T12:00:00.000Z", "ABCD-EFGH-JKMN", "$50.00"];

test("a new code is read for, then appended", async () => {
  column = ["Code", "WXYZ-2345-6789"];
  assert.equal(await appendRow(key, "sheet-1", "Gift cards", ROW, 1), true);
  const read = calls.find((call) => call.method === "GET");
  assert.ok(read?.url.includes("'Gift%20cards'!B%3AB") && read.url.includes("majorDimension=COLUMNS"), read?.url);
  assert.equal(appends(), 1);
});

test("a code already in column B counts as saved and is not appended again", async () => {
  column = ["Code", "ABCD-EFGH-JKMN"];
  assert.equal(await appendRow(key, "sheet-1", "Gift cards", ROW, 1), true);
  assert.equal(appends(), 0);
});

test("if the column cannot be read nothing is appended blindly", async () => {
  readStatus = 403;
  assert.equal(await appendRow(key, "sheet-1", "Gift cards", ROW, 1), false);
  assert.equal(appends(), 0);
});

test("without a unique column nothing is read first (the forms and the contact form)", async () => {
  assert.equal(await appendRow(key, "sheet-1", "Forms", ROW), true);
  assert.equal(calls.filter((call) => call.method === "GET").length, 0);
});

test("a tab name is quoted in A1 notation, an apostrophe doubled, for the read and the append", async () => {
  column = [];
  await appendRow(key, "sheet-1", "Owner's gift cards", ROW, 1);
  const read = calls.find((call) => call.method === "GET");
  assert.ok(read?.url.includes("'Owner''s%20gift%20cards'!B%3AB"), read?.url);
  const append = calls.find((call) => call.url.includes(":append"));
  assert.ok(append?.url.includes("/values/'Owner''s%20gift%20cards'!A%3AT:append"), append?.url);
});
