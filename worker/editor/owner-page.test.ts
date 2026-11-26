import assert from "node:assert/strict";
import { test } from "node:test";
import { escapeHtml, formatTime, renderConfirm, renderConsent, renderMessage, renderOwnerHome, type PageBase } from "./owner-page.ts";

const base: PageBase = {
  siteName: "Example Co",
  siteUrl: "https://example.test",
  email: "owner@example.test",
  theme: { white: "#ffffff", ink: "#1c1917", ink2: "#44403c", silver: "#f5f5f4", silver2: "#e7e5e4", green: "#1e4fa3", greenDeep: "#173b7a", rust: "#9a3412", line: "#d6d3d1", tint: "#e8eefa" },
};
const proposal = { id: "p1", summary: "Update hours", createdAt: "2026-01-01T12:00:00.000Z", changeList: "Page /about", previewLink: "https://preview.example.test" };

const pages = {
  home: renderOwnerHome({
    ...base,
    proposals: [proposal],
    changes: [
      { change: 1, title: "Live one", state: "live", publishedAt: "2026-01-01T10:00:00.000Z", liveAt: "2026-01-01T10:05:00.000Z" },
      { change: 2, title: "Stuck one", state: "stuck", publishedAt: "2026-01-01T10:00:00.000Z", failedChecks: ["check"] },
      { change: 3, title: "Stopped one", state: "stopped", publishedAt: "2026-01-01T10:00:00.000Z" },
    ],
  }),
  empty: renderOwnerHome({ ...base, proposals: [], changes: [] }),
  confirm: renderConfirm({ ...base, proposal }),
  consent: renderConsent({ ...base, handle: "h", clientName: "Claude", redirectHost: "claude.ai", redirectIsLoopback: false }),
  message: renderMessage({ ...base, title: "Done", body: "All good." }),
};

test("escapeHtml covers & < > \" '", () => {
  assert.equal(escapeHtml(`&<>"'`), "&amp;&lt;&gt;&quot;&#39;");
});

test("formatTime is fixed and tolerant", () => {
  assert.equal(formatTime("2026-01-01T12:00:00.000Z"), "2026-01-01 12:00 UTC");
  assert.equal(formatTime("later"), "later");
});

test("every page has the shell: lang, viewport, noindex, skip link, one h1, one main, no scripts or style attributes", () => {
  for (const [name, page] of Object.entries(pages)) {
    assert.match(page, /<html lang="en">/, name);
    assert.match(page, /<meta name="viewport" content="width=device-width, initial-scale=1">/, name);
    assert.match(page, /<meta name="robots" content="noindex, nofollow">/, name);
    assert.match(page, /<a class="skip" href="#main">/, name);
    assert.equal(page.match(/<h1[ >]/g)?.length, 1, name);
    assert.equal(page.match(/<main id="main">/g)?.length, 1, name);
    assert.doesNotMatch(page, /<script|\sstyle=|\son[a-z]+=|https?:\/\/[^"' ]*\.(js|css|woff2?)/i, name);
  }
});

test("home: sections in order, undo for live and stuck but not stopped, the connector address", () => {
  const order = ["Waiting for your yes", "Recent changes", "Connect your AI app", "What you can change"].map((h) => pages.home.indexOf(`<h2>${h}</h2>`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.ok(order.every((i) => i > 0));
  assert.match(pages.home, /Undo change 1/);
  assert.match(pages.home, /Undo change 2/);
  assert.doesNotMatch(pages.home, /Undo change 3/);
  assert.match(pages.home, /<code>https:\/\/example\.test\/mcp<\/code>/);
  assert.match(pages.empty, /Nothing is waiting\./);
  assert.match(pages.empty, /No changes yet\./);
});

test("consent: names the client and the host, and has Allow and Don't allow", () => {
  assert.match(pages.consent, /<h1>Allow Claude to edit Example Co\?<\/h1>/);
  assert.match(pages.consent, /sign-in to claude\.ai\./);
  assert.match(pages.consent, /value="allow">Allow</);
  assert.match(pages.consent, /value="deny">Don't allow</);
  assert.match(pages.consent, /Nothing goes live until you say yes in the chat\./);
});
