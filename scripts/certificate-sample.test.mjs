import assert from "node:assert/strict";
import test from "node:test";
import { makeSample } from "./certificate-sample.mjs";

test("the sample certificate is one Letter page, with and without the long texts and the logo", async () => {
  for (const options of [{}, { long: true, logo: true }]) {
    const bytes = await makeSample(options);
    const text = Buffer.from(bytes).toString("latin1");
    assert.ok(text.startsWith("%PDF-1.7"));
    assert.match(text, /\/MediaBox \[0 0 612 792\]/);
    assert.equal(text.match(/\/Type \/Page\b/g)?.length, 1);
    assert.ok(bytes.length > 20_000 && bytes.length < 400_000);
  }
});
