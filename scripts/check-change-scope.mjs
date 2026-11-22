// Change scope check: compares a branch to a base ref and says, in plain English, whether the change stays inside what a
// client change request may touch (tier 1) or needs Grant (tier 3). The allow-list is scripts/change-scope-rules.mjs;
// the explanation is docs/CHANGE-SCOPE.md. Run with `npm run check:scope`.
//
//   node scripts/check-change-scope.mjs [--base origin/main] [--head HEAD] [--strict | --report-only] [--ci]
//
// --strict (the default) exits 1 on a tier 3 file, a bad image or a new [[placeholder]]. --report-only prints the same
// report and always exits 0. --ci reads GitHub's own variables: the base comes from GITHUB_BASE_REF, and it is strict
// only when the pull request's branch (GITHUB_HEAD_REF) starts with "change/". Exit codes: 0 pass, 1 fail, 2 error.
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { rules as defaultRules } from "./change-scope-rules.mjs";

// ---- parsing git output ---------------------------------------------------------------------------------------

/** Parses `git diff --name-status -z --no-renames`: "M\0path\0A\0path\0". */
export function parseNameStatus(raw) {
  const tokens = String(raw).split("\0");
  const entries = [];
  for (let i = 0; i + 1 < tokens.length && tokens[i] !== ""; i += 2) {
    entries.push({ status: tokens[i][0], path: tokens[i + 1] });
  }
  return entries;
}

/** Parses `git diff -U0` for one file into its added and removed lines. Lines before the first @@ are headers. */
export function parseHunkLines(patch) {
  const added = [];
  const removed = [];
  let inHunk = false;
  for (const line of String(patch).split("\n")) {
    if (line.startsWith("@@")) inHunk = true;
    else if (!inHunk) continue;
    else if (line.startsWith("+")) added.push(line.slice(1));
    else if (line.startsWith("-")) removed.push(line.slice(1));
  }
  return { added, removed };
}

// ---- reading the change from git ------------------------------------------------------------------------------

/**
 * Reads a change from git. `git` is a function taking an argument array and returning a Buffer, so tests can fake it.
 * Returns { files, existsAtBase } for evaluateChange.
 */
export function gatherChange({ base, head, git, rules = defaultRules }) {
  const range = `${base}...${head}`;
  const files = parseNameStatus(git(["diff", "--name-status", "-z", "--no-renames", range])).map(({ status, path }) => {
    const file = { path, status: status === "A" || status === "D" ? status : "M", added: [], removed: [] };
    if (path.startsWith(rules.imageDir)) {
      if (file.status !== "D") {
        const bytes = git(["show", `${head}:${path}`]);
        file.size = bytes.length;
        file.head = bytes.subarray(0, 12);
      }
      return file;
    }
    Object.assign(file, parseHunkLines(git(["diff", "-U0", "--no-renames", range, "--", path])));
    if (file.status === "A" && rules.pagePath.test(path)) file.content = String(git(["show", `${head}:${path}`]));
    return file;
  });
  let mergeBase;
  const existsAtBase = (path) => {
    try {
      mergeBase ??= String(git(["merge-base", base, head])).trim();
      git(["cat-file", "-e", `${mergeBase}:${path}`]);
      return true;
    } catch {
      return false;
    }
  };
  return { files, existsAtBase };
}

// ---- the rules, applied to a change ---------------------------------------------------------------------------

function tier3Reason(path, rules) {
  return rules.tier3Labels.find(([pattern]) => pattern.test(path))[1];
}

const IMPORT_PATTERNS = [
  /^\s*import\s*["']([^"']+)["']/gm,
  /^\s*(?:import|export)\s+(?:type\s+)?[^"';]*?\bfrom\s*["']([^"']+)["']/gm,
];

/** A new page is tier 1 only when it is built from what the site already has. Returns { ok } or { ok: false, reason }. */
function checkNewPage(file, rules, existsAtBase) {
  const { content } = file;
  if (typeof content !== "string") return { ok: false, reason: "a new page whose contents could not be read" };
  for (const text of rules.pageForbidden) {
    if (content.includes(text)) return { ok: false, reason: `a new page may not contain ${text}` };
  }
  for (const text of rules.pageRequires) {
    if (!content.includes(text)) return { ok: false, reason: `a new page must call ${text} (the shared SEO helper)` };
  }
  const { exact, contentPrefix, componentPrefix } = rules.pageImports;
  for (const spec of IMPORT_PATTERNS.flatMap((pattern) => [...content.matchAll(pattern)].map((m) => m[1]))) {
    if (exact.includes(spec)) continue;
    if (spec.startsWith(contentPrefix)) {
      const target = `src/content/${spec.slice(contentPrefix.length)}.ts`;
      if (rules.contentFile.test(target) && !rules.contentWiring.includes(target)) continue;
    } else if (spec.startsWith(componentPrefix)) {
      const target = `src/components/${spec.slice(componentPrefix.length)}`;
      if ([".tsx", ".ts", "/index.tsx", "/index.ts"].some((ending) => existsAtBase(target + ending))) continue;
    }
    return { ok: false, reason: `a new page imports ${spec}, which is not an existing component, content file or @/lib/metadata` };
  }
  return { ok: true };
}

function classify(file, rules, existsAtBase) {
  const { path, status } = file;
  if (rules.tier1Files.includes(path)) return { ok: true };
  if (rules.contentFile.test(path) && !rules.contentWiring.includes(path)) return { ok: true };
  if (path.startsWith(rules.imageDir)) return { ok: true };
  if (rules.pagePath.test(path)) {
    if (status === "D") return { ok: true };
    if (status === "A") return checkNewPage(file, rules, existsAtBase);
  }
  return { ok: false, reason: tier3Reason(path, rules) };
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const snippet = (line) => (line.trim().length > 70 ? `${line.trim().slice(0, 67)}...` : line.trim());
const routeStrings = (lines) => new Set(lines.flatMap((line) => [...line.matchAll(/["'](\/[a-z0-9/-]*)["']/g)].map((m) => m[1])));

function imageProblems(file, rules) {
  const dot = file.path.lastIndexOf(".");
  const extension = dot > file.path.lastIndexOf("/") ? file.path.slice(dot).toLowerCase() : "";
  if (extension === ".svg") return ["SVG files are not allowed (they can carry code). Use jpg, png or webp."];
  if (!Object.hasOwn(rules.imageTypes, extension)) return [`${extension || "a file with no extension"} is not allowed. Use jpg, png or webp.`];
  const problems = [];
  const bytes = file.head ?? Buffer.alloc(0);
  const type = rules.imageTypes[extension];
  const matches =
    (type === "jpeg" && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) ||
    (type === "png" && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (type === "webp" && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP");
  if (!matches) problems.push(`the file's contents are not really a ${extension.slice(1)} image (renamed file?)`);
  if ((file.size ?? 0) > rules.maxImageBytes) {
    problems.push(`${Math.round(file.size / 1024)} KB is over the ${Math.round(rules.maxImageBytes / 1024)} KB limit`);
  }
  return problems;
}

/** The pure core: takes { files, existsAtBase } and returns the verdict. No git, no disk. */
export function evaluateChange({ files, existsAtBase }, rules = defaultRules) {
  const result = { tier: 1, outside: [], flags: [], imageProblems: [], placeholders: [], fileCount: files.length, lineCount: 0 };
  const flag = (kind, path, detail) => result.flags.push({ kind, path, detail });
  const schedulerPattern = new RegExp(`https?://(?:[\\w-]+\\.)*(?:${rules.schedulerHosts.map(escapeRegExp).join("|")})\\b`, "i");
  const addedRoutes = routeStrings(files.find((f) => f.path === "src/lib/routes.ts")?.added ?? []);

  for (const file of files) {
    const verdict = classify(file, rules, existsAtBase);
    if (!verdict.ok) result.outside.push({ path: file.path, reason: verdict.reason });

    const page = rules.pagePath.exec(file.path);
    if (page && file.status === "D") flag("removed-page", file.path, `the page /${page[1]} was deleted`);
    if (page && file.status === "A" && verdict.ok && !addedRoutes.has(`/${page[1]}`)) {
      flag("new-page-not-in-routes", file.path, `/${page[1]} is not added to src/lib/routes.ts, so the sitemap and the accessibility scan would miss it`);
    }
    if (file.path === "src/lib/routes.ts") {
      for (const route of routeStrings(file.removed)) {
        if (!addedRoutes.has(route)) flag("removed-page", file.path, `the route ${route} was removed from the page list`);
      }
    }
    if (rules.sensitiveFiles.includes(file.path)) flag("sensitive-file", file.path, "legal text or the contact form's questions changed");

    if (file.path.startsWith(rules.imageDir)) {
      if (file.status !== "D") for (const reason of imageProblems(file, rules)) result.imageProblems.push({ path: file.path, reason });
      continue;
    }
    result.lineCount += file.added.length + file.removed.length;
    for (const [side, lines] of [["added", file.added], ["removed", file.removed]]) {
      for (const line of lines) {
        if (rules.dollarPatterns.some((p) => p.test(line))) flag("dollar", file.path, `a dollar amount is ${side}: ${snippet(line)}`);
        if (rules.contactPatterns.some((p) => p.test(line)) || schedulerPattern.test(line)) {
          flag("contact", file.path, `a contact detail or booking link is ${side}: ${snippet(line)}`);
        }
      }
    }
    if (rules.placeholderDirs.some((dir) => file.path.startsWith(dir)) && rules.placeholderFiles.test(file.path) && file.status !== "D") {
      for (const line of file.added) {
        for (const match of line.matchAll(rules.placeholderPattern)) result.placeholders.push({ path: file.path, text: match[0] });
      }
    }
  }

  if (result.lineCount > rules.maxChangedLines) {
    flag("size", "", `${result.lineCount} lines changed (the limit is ${rules.maxChangedLines})`);
  }
  if (result.fileCount > rules.maxFiles) flag("size", "", `${result.fileCount} files changed (the limit is ${rules.maxFiles})`);
  if (result.outside.length > 0) result.tier = 3;
  return result;
}

/** strict: fail on tier 3, a bad image or a new placeholder. report-only: never fail. */
export function decide(result, mode) {
  const reasons = [];
  if (result.outside.length > 0) reasons.push("files outside tier 1");
  if (result.imageProblems.length > 0) reasons.push("image rule broken");
  if (result.placeholders.length > 0) reasons.push("leftover [[placeholder]] text");
  return { ok: mode !== "strict" || reasons.length === 0, reasons };
}

// ---- the plain-English report ---------------------------------------------------------------------------------

const MAX_LISTED = 20;
const list = (items) => [...items.slice(0, MAX_LISTED), ...(items.length > MAX_LISTED ? [`  ...and ${items.length - MAX_LISTED} more`] : [])];

export function formatReport(result, { mode = "strict", base, head } = {}) {
  const lines = [`Change scope check${base ? ` (${base}...${head})` : ""}`, ""];
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (result.tier === 1) {
    lines.push(`Tier 1: this change only touches content (${plural(result.fileCount, "file")}). A client can ask for this.`);
  } else {
    lines.push(`Tier 3: this change needs Grant. ${plural(result.outside.length, "file")} outside what a client change may touch:`);
    lines.push(...list(result.outside.map((o) => `  - ${o.path} (${o.reason})`)));
  }
  if (result.flags.length > 0) {
    // Repeats of one kind in one file are shown once, with a count, so a big diff stays readable.
    const groups = new Map();
    for (const f of result.flags) {
      const key = `${f.kind}\0${f.path}`;
      groups.set(key, groups.has(key) ? { ...groups.get(key), extra: groups.get(key).extra + 1 } : { ...f, extra: 0 });
    }
    lines.push("", `Flagged for Grant (${plural(groups.size, "flag")}; the change still passes, but look at it before the client does):`);
    lines.push(...list([...groups.values()].map((f) => `  - ${f.path ? `${f.path}: ` : ""}${f.detail}${f.extra > 0 ? ` (and ${f.extra} more like it)` : ""}`)));
  }
  if (result.imageProblems.length > 0) {
    lines.push("", "Image problems (blocking on client change branches):");
    lines.push(...list(result.imageProblems.map((p) => `  - ${p.path}: ${p.reason}`)));
  }
  if (result.placeholders.length > 0) {
    lines.push("", "Leftover [[placeholder]] text added by this change (blocking on client change branches):");
    lines.push(...list(result.placeholders.map((p) => `  - ${p.path}: ${p.text}`)));
  }
  const { ok, reasons } = decide(result, mode);
  lines.push("");
  if (mode !== "strict") {
    lines.push("Result: report only. This is not a client change branch, so nothing here blocks the merge.");
  } else {
    lines.push(ok ? "Result: PASS." : `Result: FAIL (${reasons.join(", ")}).`);
  }
  return lines.join("\n");
}

// ---- command line ---------------------------------------------------------------------------------------------

export function parseArgs(argv, env) {
  let base;
  let head;
  let mode;
  let ci = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--base" || arg === "--head") {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) return { error: `${arg} needs a value` };
      if (arg === "--base") base = value;
      else head = value;
      i += 1;
    } else if (arg === "--strict") mode = "strict";
    else if (arg === "--report-only") mode = "report-only";
    else if (arg === "--ci") ci = true;
    else return { error: `Unknown option ${arg}. Options: --base <ref>, --head <ref>, --strict, --report-only, --ci` };
  }
  if (ci) {
    if (!env.GITHUB_BASE_REF && base === undefined) return { skip: "Change scope check skipped: this is not a pull request, so there is nothing to compare." };
    base ??= `origin/${env.GITHUB_BASE_REF}`;
    mode ??= (env.GITHUB_HEAD_REF ?? "").startsWith("change/") ? "strict" : "report-only";
  }
  return { base: base ?? "origin/main", head: head ?? "HEAD", mode: mode ?? "strict" };
}

export function realGit(args) {
  return execFileSync("git", ["--literal-pathspecs", ...args], { maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

/** Returns the exit code: 0 pass, 1 fail, 2 could not run. */
export function main({ argv, env = process.env, git = realGit, out = console.log }) {
  const args = parseArgs(argv, env);
  if (args.error) {
    out(`Change scope check could not run: ${args.error}`);
    return 2;
  }
  if (args.skip) {
    out(args.skip);
    return 0;
  }
  let change;
  try {
    change = gatherChange({ base: args.base, head: args.head, git });
  } catch (error) {
    out(`Change scope check could not read the git history: ${error.stderr?.toString().trim() || error.message}`);
    return 2;
  }
  const result = evaluateChange(change, defaultRules);
  const text = formatReport(result, args);
  out(text);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `\`\`\`text\n${text}\n\`\`\`\n`);
  return decide(result, args.mode).ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main({ argv: process.argv.slice(2) });
}
