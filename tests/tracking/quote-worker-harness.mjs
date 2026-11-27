// Test support for tests/tracking/quote-flow.spec.ts: runs the real Worker code (worker/contact.ts) in its own Node
// process, which loads the Worker's TypeScript and JSON imports natively (as `npm run test:worker` does), behind a tiny
// local HTTP server. Every outside call the Worker makes (Turnstile, the Sheet's Apps Script, Resend) is answered here
// and recorded; nothing leaves the machine. Usage: node tests/tracking/quote-worker-harness.mjs <port>
import { createServer } from "node:http";
import { exampleCatalog } from "../../src/catalog/example.ts";
import { buildCatalogData } from "../../src/catalog/data.ts";
import { formFiles } from "../../src/forms/registry.generated.ts";
import { buildWorkerConfig } from "../../worker/config.ts";
import { createWorker } from "../../worker/contact.ts";

const ORIGIN = "https://example.test";
const port = Number(process.argv[2] ?? "4824");

const worker = createWorker(
  buildWorkerConfig({
    business: { name: "Example Co", tagline: "Plain words for plain work" },
    owner: { name: "Pat Example", role: "Founder" },
    domain: { url: ORIGIN, workerName: "example-site", previewHostSuffix: ".workers.dev" },
    forms: { maxForms: 10, maxFields: 12, maxAnswerChars: 20000, maxBodyBytes: 32768 },
    contact: {
      siteEmail: "hello@example.test",
      fromName: "Example Co",
      replyFromName: "Pat Example",
      schedulerUrl: "https://example.test/book",
      sheetWriter: "apps-script",
      sheetTabs: { production: "Submissions", preview: "Preview" },
      emailColors: { green: "#112233", ink: "#223344", ink2: "#334455", rust: "#445566", line: "#556677" },
    },
  }),
  formFiles,
  true,
);

// The showcase's pieces, priced as the showcase page priced them, served as the site's own /catalog.json. A real catalog
// page is one segment, so the data names "/catalog" (the showcase's own pages live under /blocks/catalog).
const catalogData = buildCatalogData({ items: exampleCatalog.items, settings: exampleCatalog.settings, pricing: exampleCatalog.pricing, pagePath: "/catalog" });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const sent = [];
globalThis.fetch = async (input, init = {}) => {
  const url = String(input);
  sent.push({ url, json: typeof init.body === "string" ? JSON.parse(init.body) : {} });
  if (url.includes("turnstile/v0/siteverify")) return json({ success: true, hostname: "example.test", action: "form" });
  if (url.startsWith("https://script.google.com/")) return json({ ok: true });
  if (url === "https://api.resend.com/emails") return json({ id: "email-1" });
  throw new Error(`Unexpected outside call: ${url}`);
};

const env = {
  SITE_ENV: "production",
  RESEND_API_KEY: "re_test",
  TURNSTILE_SECRET_KEY: "turnstile-test-secret",
  SHEET_WEBHOOK_URL: "https://script.google.com/macros/s/EXAMPLE_DEPLOYMENT_ID/exec",
  SHEET_WEBHOOK_SECRET: "webhook-test-secret",
  CONTACT_RATE_LIMIT: { limit: async () => ({ success: true }) },
  ASSETS: { fetch: async () => json(catalogData) },
};

const readAll = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
};

createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/sent") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(sent));
      return;
    }
    // POST /worker: { method, path, headers, body } as the browser sent it; answers { status, cookies, body }.
    const forwarded = JSON.parse(await readAll(req));
    const request = new Request(`${ORIGIN}${forwarded.path}`, {
      method: forwarded.method,
      headers: { ...forwarded.headers, origin: ORIGIN, "sec-fetch-site": "same-origin", "cf-connecting-ip": "203.0.113.9" },
      body: forwarded.body ?? undefined,
    });
    const response = await worker.fetch(request, env);
    const answer = { status: response.status, cookies: response.headers.getSetCookie(), body: await response.text() };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(answer));
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" }).end(String(error));
  }
}).listen(port, () => console.log(`ready ${port}`));
