import assert from "node:assert/strict";
import test from "node:test";
import { loadCertificateAssets } from "./certificate-assets.ts";

const font = new Uint8Array(40).fill(7);
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...new Array(40).fill(0)]);

function deps(overrides: Record<string, Response | Error> = {}, toPng?: (s: ReadableStream) => Promise<Uint8Array | null>) {
  const asked: string[] = [];
  return {
    asked,
    fetchAsset: async (path: string) => {
      asked.push(path);
      const given = overrides[path];
      if (given instanceof Error) throw given;
      if (given) return given;
      if (path.startsWith("/_certificate/")) return new Response(font);
      return new Response(new Uint8Array([1, 2, 3]));
    },
    toPng,
  };
}

test("loads the three fonts from /_certificate/ and no logo when the site has none", async () => {
  const d = deps();
  const assets = await loadCertificateAssets(d, null);
  assert.deepEqual([...d.asked].sort(), ["/_certificate/accent.ttf", "/_certificate/display-bold.ttf", "/_certificate/display.ttf"]);
  assert.equal(assets.display.length, 40);
  assert.equal(assets.logo, null);
});

test("turns the uploaded logo into PNG through toPng", async () => {
  const d = deps({}, async (stream) => {
    assert.ok(stream instanceof ReadableStream);
    return png;
  });
  const assets = await loadCertificateAssets(d, "/images/uploads/abc.webp");
  assert.ok(d.asked.includes("/images/uploads/abc.webp"));
  assert.deepEqual(assets.logo, { png });
});

test("any logo failure gives no logo: missing file, toPng null or throwing, not a PNG, no converter", async () => {
  const src = "/images/uploads/abc.webp";
  assert.equal((await loadCertificateAssets(deps({ [src]: new Response("no", { status: 404 }) }, async () => png), src)).logo, null);
  assert.equal((await loadCertificateAssets(deps({}, async () => null), src)).logo, null);
  assert.equal((await loadCertificateAssets(deps({}, async () => { throw new Error("images down"); }), src)).logo, null);
  assert.equal((await loadCertificateAssets(deps({}, async () => new Uint8Array([1, 2, 3])), src)).logo, null);
  assert.equal((await loadCertificateAssets(deps({ [src]: new Error("network") }, async () => png), src)).logo, null);
  assert.equal((await loadCertificateAssets(deps(), src)).logo, null);
});

test("a missing or empty font throws", async () => {
  await assert.rejects(loadCertificateAssets(deps({ "/_certificate/accent.ttf": new Response("", { status: 404 }) }), null), /accent\.ttf/);
  await assert.rejects(loadCertificateAssets(deps({ "/_certificate/display.ttf": new Response(new Uint8Array(2)) }), null), /empty/);
});
