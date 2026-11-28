import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { ContactEnv } from "../env.ts";
import type { CertificateInput } from "./certificate-types.ts";
import { certificateDeps, makeCertificate } from "./make-certificate.ts";

const fontFile = (name: string) => readFileSync(new URL(`../../src/brand/certificate-fonts/${name}`, import.meta.url));
const SERVED: Record<string, Uint8Array> = {
  "/_certificate/display.ttf": fontFile("display-outfit-400.ttf"),
  "/_certificate/display-bold.ttf": fontFile("display-outfit-600.ttf"),
  "/_certificate/accent.ttf": fontFile("accent-newsreader-italic.ttf"),
};

function assetsEnv(served: Record<string, Uint8Array>): { env: ContactEnv; asked: string[] } {
  const asked: string[] = [];
  const env = {
    ASSETS: {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        asked.push(path);
        const body = served[path];
        return body ? new Response(body) : new Response(null, { status: 404 });
      },
    },
  } as unknown as ContactEnv;
  return { env, asked };
}

const INPUT: CertificateInput = {
  businessName: "Example Studio",
  siteHost: "example.test",
  amountText: "$50.00",
  code: "ABCD-EFGH-JKMN",
  to: "Dana",
  from: "Sam",
  message: "Happy birthday.",
  redeemWording: "Quote the code when you book.",
  termsLine: "One certificate per visit.",
  issuedOn: "27 November 2026",
  validUntil: null,
  colors: { green: "#1e4fa3", ink: "#1c1917", ink2: "#44403c", rust: "#9a3412", line: "#d6d3d1" },
};

test("the real maker reads the three fonts from the site's own files and returns one PDF page", async () => {
  const { env, asked } = assetsEnv(SERVED);
  const pdf = await makeCertificate(INPUT, env, "https://example.test/api/payments/stripe");
  const text = new TextDecoder("latin1").decode(pdf);
  assert.ok(text.startsWith("%PDF-"));
  assert.equal((text.match(/\/Type\s*\/Page\b/g) ?? []).length, 1);
  assert.deepEqual([...asked].sort(), Object.keys(SERVED).sort());
});

test("a missing font stops the certificate (the webhook then retries and the owner is told)", async () => {
  const { env } = assetsEnv({});
  await assert.rejects(makeCertificate(INPUT, env, "https://example.test/x"), /Certificate font/);
});

test("without the Images binding there is no PNG step, so the logo falls back to the business name", () => {
  const { env } = assetsEnv(SERVED);
  assert.equal(certificateDeps(env, "https://example.test/").toPng, undefined);
});

test("with the Images binding the logo is asked for as PNG", async () => {
  const formats: string[] = [];
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const env = {
    IMAGES: {
      input: () => ({
        output: async (options: { format: string }) => {
          formats.push(options.format);
          return { image: () => new Response(png).body };
        },
      }),
    },
  } as unknown as ContactEnv;
  const toPng = certificateDeps(env, "https://example.test/").toPng;
  assert.ok(toPng);
  assert.deepEqual(await toPng(new Response("webp").body as ReadableStream), png);
  assert.deepEqual(formats, ["image/png"]);
});
