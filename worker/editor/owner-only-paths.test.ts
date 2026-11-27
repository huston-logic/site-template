import assert from "node:assert/strict";
import { test } from "node:test";
import { isCommittablePath } from "./site-reader.ts";

// The tracking IDs live in site.config.ts, which is owner-only: no chat tool may write it. The editor's commit allow-list
// (isCommittablePath) is the one gate every file passes through before a commit, so the files that hold or enforce the
// tracking settings must all be outside it.
test("the editor can never write the tracking settings or the files generated from them", () => {
  for (const path of [
    "site.config.ts",
    "./site.config.ts",
    "src/tracking/config.ts",
    "wrangler.jsonc",
    "public/_headers",
    "public/_redirects",
    "src/content/pages/../../../site.config.ts",
    "src/content/collections/posts/../../../../site.config.ts",
  ]) {
    assert.equal(isCommittablePath(path), false, path);
  }
});
