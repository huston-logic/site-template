import assert from "node:assert/strict";
import { test } from "node:test";
import { CAPTURE_SCRIPT } from "./capture-script.ts";

interface Call {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string; keepalive: boolean; credentials: string };
}

function run(search: string, referrer: string, fetchImpl?: (url: string, init: Call["init"]) => unknown) {
  const calls: Call[] = [];
  const location = { search, pathname: "/landing", host: "example.com" };
  const fetchFake = (url: string, init: Call["init"]) => {
    calls.push({ url, init });
    return fetchImpl ? fetchImpl(url, init) : Promise.resolve({});
  };
  new Function("location", "document", "fetch", CAPTURE_SCRIPT)(location, { referrer }, fetchFake);
  return calls;
}

test("a direct visit sends nothing", () => {
  assert.equal(run("", "").length, 0);
  assert.equal(run("?page=2", "").length, 0);
});

test("an internal referrer sends nothing", () => {
  assert.equal(run("", "https://example.com/about").length, 0);
});

test("utm and click ID parameters send the exact body", () => {
  for (const search of ["?utm_source=google&utm_medium=cpc", "?gclid=abc", "?x=1&fbclid=z"]) {
    const calls = run(search, "");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/api/visit");
    assert.deepEqual(calls[0].init, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: `/landing${search}`, referrer: "" }),
      keepalive: true,
      credentials: "same-origin",
    });
  }
});

test("an external referrer sends the referrer", () => {
  const calls = run("", "https://news.example.org/story");
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].init.body), { path: "/landing", referrer: "https://news.example.org/story" });
});

test("a failing fetch never throws", () => {
  assert.doesNotThrow(() => run("?gclid=a", "", () => Promise.reject(new Error("offline"))));
  assert.doesNotThrow(() => run("?gclid=a", "", () => { throw new Error("sync"); }));
  assert.doesNotThrow(() => run("?gclid=a", "", () => undefined));
});

test("a malformed referrer never throws", () => {
  assert.equal(run("", "not a url").length, 0);
  assert.equal(run("?gclid=a", "::::").length, 1);
});

test("the script is plain and small", () => {
  assert.ok(CAPTURE_SCRIPT.length < 1024);
  assert.ok(!CAPTURE_SCRIPT.includes("</script"));
});
