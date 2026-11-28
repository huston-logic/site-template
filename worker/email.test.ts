// sendEmail and Resend's answers: a reused idempotency key (409) means the email already went out.
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { sendEmail, type OutgoingEmail } from "./email.ts";

const EMAIL: OutgoingEmail = { from: "a@example.test", to: "b@example.test", replyTo: "a@example.test", subject: "Hi", text: "Hello" };
const realFetch = globalThis.fetch;
const realLog = console.log;
let logs: string[] = [];
let calls = 0;
let status = 200;

beforeEach(() => {
  logs = [];
  calls = 0;
  console.log = (...args: unknown[]) => logs.push(args.join(" "));
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("{}", { status });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.log = realLog;
});

test("a 409 (the key was already used, perhaps with different text) counts as sent and is not retried", async () => {
  status = 409;
  assert.equal(await sendEmail("re_test", EMAIL, "gift-pi_1-owner", "gift_owner"), true);
  assert.equal(calls, 1);
  assert.ok(logs.some((line) => line.includes("email_duplicate")));
});

test("other refusals still fail, and a server error is retried once", async () => {
  status = 422;
  assert.equal(await sendEmail("re_test", EMAIL, "k", "x"), false);
  assert.equal(calls, 1);
  calls = 0;
  status = 500;
  assert.equal(await sendEmail("re_test", EMAIL, "k", "x"), false);
  assert.equal(calls, 2);
});
