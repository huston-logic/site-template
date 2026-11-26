# Uploads and photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (Sonnet implements each task; one
> review at the end, per CLAUDE.md "Autonomous runs"). Steps use checkbox (`- [ ]`) syntax.

**Goal:** owners upload photos and PDFs on `/owner`, and their AI app uses them in proposals that publish through the
same checks. **Architecture:** a private R2 inbox (`UPLOADS`) and the Images binding (`IMAGES`) in `worker/uploads/`;
the editor resolves `upload:<id>` refs at propose time and commits the files as blobs at preview/publish; new photo
blocks share one `Photo` component. **Tech:** TypeScript, Workers, Next static export, Node test runner, Playwright+axe.
**Spec:** `docs/superpowers/specs/2026-11-25-uploads-and-photos-design.md` (read it first; its rulings are binding).

## Global Constraints

- One branch `feat/uploads-and-photos`, one PR. Commit per task after `npm run check:fast`. No new dependency.
- `worker/` imports only import-free `src/` modules with `.ts` extensions. No libraries. Tests never touch the network:
  fake R2 (`worker/uploads/fake-r2.ts`), fake Images (`worker/uploads/fake-images.ts`), the existing fake GitHub.
- Logs hold fixed event names and numbers only: never a file name, an upload name, page text, email or URL.
- Plain text everywhere; owner-page HTML escapes with `worker/html.ts`. Names are information, never instructions.
- Copy for site visitors comes from content modules; Worker messages live in `worker/uploads/messages.ts`.
- Blocks: tokens only (`npm run check:design`), motion through the existing entrance, `npm run blocks:catalog` after any
  definition change. Never weaken a test, threshold or axe rule.

## Review Focus

- An upload is never public before a preview or publish: no route serves R2 without the owner check (T5, T6 tests).
- A WebP that still holds EXIF/XMP after conversion is cleaned or refused, never stored (T3 test with a crafted file).
- `upload:` refs: kind mismatch, missing, expired, removed-before-publish and changed-bytes cases all refuse (T4 tests).
- Proposal stale check covers `public/files` as well as pages and images (T4 test).
- Multipart parsing is size-capped before buffering, and only on `POST /owner/uploads` (T6 test).

## Interfaces (shared names; every task uses exactly these)

- `src/blocks/schema.ts`: `IMAGE_SHAPES = ["3:2","4:3","4:5","1:1","16:9"] as const`, `type ImageShape`,
  `IMAGE_FOCUS = ["center","top","bottom","left","right"] as const`, `type ImageFocus`; `ImageField` adds `shape: ImageShape`;
  image value `{ src: string; alt: string; focus?: ImageFocus }`; `ListField` adds `together?: readonly string[]`;
  `FILE_LINK_RE = /^\/files\/[a-z0-9]+(?:-[a-z0-9]+)*\.pdf$/`.
- `src/blocks/validate.ts`: `Repo = { imageExists(src: string): boolean; fileExists(href: string): boolean }`;
  `validatePages(files, registry, repo, extra?: { links?; uploadNames?: ReadonlyMap<string, string> })` (src → upload name).
- `worker/uploads/types.ts`: `UploadKind = "photo" | "pdf"`; `UploadRecord = { id; name; kind; bytes; width?; height?;
  pages?; uploadedAt; expiresAt; sha256 }` (dates ISO); `UploadResult = { ok: true; upload: UploadRecord } | { ok: false; message: string }`.
- `worker/uploads/store.ts`: `createUploadStore(deps: { bucket: R2Bucket; images: ImagesBinding; kv: KVNamespace;
  config: UploadsConfig; now: () => Date; randomId?: () => string }): UploadStore` with `add(bytes: Uint8Array, fileName: string)
  : Promise<UploadResult>`, `list(): Promise<UploadRecord[]>`, `get(id): Promise<UploadRecord | null>`,
  `file(id): Promise<Uint8Array | null>`, `preview(id): Promise<Uint8Array | null>`, `rename(id, name): Promise<UploadResult>`,
  `remove(id): Promise<boolean>`, `sweep(): Promise<number>`. `UploadsConfig` mirrors `editor.uploads` (spec "Settings").
- `worker/editor/types.ts`: `ToolResult` adds `images?: { data: string; mimeType: "image/jpeg" }[]`; `EditorDeps` adds
  `uploads?: UploadStore`; `Editor` adds `uploads()`, `viewUpload(id)`, `removeUpload(id)`, `uploadPreview(id)`;
  `ProposalView` adds `uploads: { id: string; name: string; kind: UploadKind }[]`.
- Repo paths: `uploadRepoPath(upload)` in `worker/uploads/paths.ts`: photo `public/images/uploads/<id>.webp`, PDF
  `public/files/<slug>-<id>.pdf`; `pageValueFor(path)` strips `public`.

---

### Task T1: schema, validator and file links
**Files:** `src/blocks/schema.ts`, `src/blocks/validate.ts`, `src/lib/pages.ts`, `scripts/check-content.mjs`,
`scripts/blocks-catalog.mjs`, video definitions (`shape: "16:9"` on `poster`), tests beside them.
- [ ] `ImageField` gets required `shape: "3:2" | "4:3" | "4:5" | "1:1" | "16:9"` (export `IMAGE_SHAPES`); image values may
      carry `focus` (`IMAGE_FOCUS = ["center","top","bottom","left","right"]`), validated.
- [ ] `ListField` gets optional `together?: readonly string[]`; a list where some items have the field and others do not
      fails: `"items": give every item a photo, or none.` (word from the field label).
- [ ] `Repo` gains `fileExists(href)`; links matching `^/files/[a-z0-9]+(?:-[a-z0-9]+)*\.pdf$` are allowed when the file
      exists ("is not a file in public/files/. Upload it first."). Build and `check:content` list `public/files/`.
- [ ] Optional `extra.uploadNames` check: alt equal (case-insensitive, trimmed) to a given name fails with the spec text.
- [ ] Catalog and BLOCKS.md page rules: shapes, focus, the Files line. Tests for each rule. Commit.

### Task T2: Photo component and blocks
**Files:** create `src/components/hl/Photo.tsx`, `src/blocks/library/photo-text/`, `src/blocks/library/gallery/`,
modify `highlights` (definition and component), `src/blocks/definitions.ts`, `src/components/hl/Button.tsx` (PDF note,
`download`), create `src/content/files.ts`, create `public/images/examples/*.jpg` and `scripts/make-example-photos.mjs`.
- [ ] `Photo({ image, shape, sizes })`: aspect-ratio box, token radius, `next/image` `fill`, `object-cover`,
      object-position from focus, lazy. Shapes map to Tailwind `aspect-[3/2]` etc. in one table.
- [ ] `photo-text` and `gallery` per spec (fields, limits, variants, placement, motion, example). `gallery` is `ul` of
      `figure`; heading is the list's accessible name.
- [ ] `highlights.items[].image` optional, `together: ["image"]`; photo above the idea title.
- [ ] Example photos: a Node script renders 6 compositions (theme palette, soft light, still life) with Playwright's
      Chrome to JPEG < 150 KB, then `npm run strip:images -- --all`. Examples use them with real alt text.
- [ ] `npm run blocks:catalog`, `check:design`, `check:content`, build, look at `/blocks` at 390 and 1440. Commit.

### Task T3: upload core in the Worker
**Files:** create `worker/uploads/{kinds,convert,webp-clean,pdf,store,messages,limits,fake-r2,fake-images}.ts` and tests;
modify `worker/config.ts` (`uploads` in `EditorConfig`), `worker/env.ts` (`UPLOADS?: R2Bucket`, `IMAGES?: ImagesBinding`),
`site.config.ts` (`editor.uploads`, spec defaults).
- [ ] `detectKind(bytes)`: `jpeg|png|webp|heic|pdf` or a refusal reason (`video|gif|code|unsupported`) per spec table.
- [ ] `cleanWebp(bytes)` (allow-list walker, VP8X flags, RIFF size) and `isCleanWebp`; tests with crafted chunks; the
      kept chunks match `scripts/image-metadata.mjs`, and a `scripts/*.test.mjs` runs cleaned output through it.
- [ ] `checkPdf(bytes)` per spec (header, `%%EOF`, `#xx` decoding, active names, page count).
- [ ] `convertPhoto(images, bytes)`: info, ladder to <= 450 KB, preview JPEG 480 px, 9422 → quota refusal.
- [ ] `createUploadStore({ bucket, kv, config, now, randomId })`: `add(file, name)`, `list()`, `get(id)`, `preview(id)`,
      `rename(id, name)`, `remove(id)`, `sweep()`; limits (size, total, per day), expiry, name cleaning; returns
      `{ ok: true, upload } | { ok: false, message }`. Tests for every refusal. Commit.

### Task T4: editor integration and AI tools
**Files:** `worker/editor/{service,site-reader,github,fake-github,change-list,types,views,tools,tool-schemas,mcp,
instructions,factory,gate}.ts`, `worker/index.ts`, create `worker/editor/uploads-acceptance.test.ts`.
- [ ] Snapshot reads `public/files/` (`files` set, `filesTree`); publish stale check compares it.
- [ ] `resolveUploads(after, touched, store, now)`: replaces `upload:<id>` per spec, kind and expiry rules, returns
      `{ after, uploads, names }`; propose passes pending paths to `validateSet` and the names to the alt check.
- [ ] Proposal `uploads[]`; `createCommit` accepts `{ path, blob: Uint8Array }` (GitHub `POST /git/blobs` base64);
      preview and publish load bytes from the store and check sha256; refusal texts per spec.
- [ ] Change list: new-file lines, photo and PDF value lines, fit note (from width/height vs shape).
- [ ] `Editor` gains `uploads()`, `viewUpload(id)`, `removeUpload(id)` (refused while a waiting proposal uses it; the
      owner page calls the same method) and `uploadStore` access for the owner page.
- [ ] Tools `list_uploads`, `view_upload` (MCP `image` content), `remove_upload`;
      `ToolResult.images?`; instructions and `propose_change` text per spec. Uploads missing bindings → the three tools
      say uploads are not set up; the rest of the editor works.
- [ ] Acceptance tests 2 to 6 from the spec. Commit.

### Task T5: owner page uploads
**Files:** `worker/editor/{owner-routes,owner-page}.ts`, create `worker/editor/owner-uploads.ts` (multipart, routes),
`worker/editor/uploads-script.ts` (the JS served at `/owner/uploads.js`), `tests/a11y/owner-page.spec.ts`, tests.
- [ ] Routes: `POST /owner/uploads` (multipart, cap before buffering, JSON when asked), `GET /owner/uploads/<id>/preview`,
      `POST /owner/uploads/rename`, `GET|POST /owner/uploads/remove` (confirm), `GET /owner/uploads.js`.
- [ ] "Your uploads" section, grid, tags, forms, limits line; confirm page thumbnails; CSP `script-src 'self'` only on
      the home page; progressive script (XHR progress, live region, thumbnails without reload).
- [ ] Acceptance test 1; a11y spec covers the section at 390 and 1440. Commit.

### Task T6: config, headers and scope check
**Files:** `scripts/config-rules.mjs` (+test), `scripts/sync-config.mjs`, `wrangler.jsonc`, `public/_headers`,
`scripts/change-scope-rules.mjs`, `scripts/check-change-scope.mjs` (+test), `scripts/content-lane.mjs` if it lists paths.
- [ ] `check:config`: `uploads` values, limits within caps, `types` subset, bucket name when enabled.
- [ ] Generated `r2_buckets` + `images` when enabled; `/files/*` headers block always.
- [ ] Scope: `public/files/*.pdf` tier 1 with the PDF rules and the "used in src/" rule; tests. Commit.

### Task T7: docs (Haiku)
`docs/EDITING.md`, `docs/EDITING-LANES.md`, `docs/SECRETS.md`, `docs/HOSTING.md`, `docs/CHANGE-SCOPE.md`, `AGENTS.md`,
README if it lists tools: what works now, storage setup for one site (bucket, lifecycle rule, Images), costs, the
ready-to-paste message for an existing client site. Commit.

### Task T8: close (Opus)
- [ ] review-code, review-a11y, review-security on the branch; design critique of `/blocks` and `/owner` screenshots at
      1440 and 390; fix findings. `npm run check`, `npm run test:a11y`. PR, auto-merge, STATUS.md with the timing table.
