import type { EditorConfig } from "../config.ts";
import type { GitHub, Pull } from "./github.ts";
import type { AssetsLike } from "./types.ts";

/** Where an editor change stands: checking, stuck, going live, live or stopped. Never says live without proof. */

export const BRANCH_PREFIX = "change/owner-";
const FAILED = ["failure", "timed_out", "cancelled", "action_required"];

export type ChangeState = "checking" | "stuck" | "going live" | "live" | "stopped";

export interface ChangeStatus {
  change: number;
  state: ChangeState;
  title: string;
  publishedAt: string;
  liveAt?: string;
  minutesToLive?: number;
  failedChecks?: string[];
  /** True when the site does not report which commit it runs, so "live" cannot be confirmed. */
  unconfirmed?: boolean;
}

export const isEditorPull = (pull: Pull, config: EditorConfig): boolean => pull.headRef.startsWith(BRANCH_PREFIX) && pull.author === config.github.botLogin;

export async function editorPulls(github: GitHub, config: EditorConfig, state: "open" | "all"): Promise<Pull[]> {
  return (await github.listPulls(state)).filter((pull) => isEditorPull(pull, config)).sort((a, b) => b.number - a.number);
}

export const changeTitle = (pull: Pull): string => pull.title.replace(/^change: /, "");

/** The deployed site's commit, read once per call through the ASSETS binding; null when it cannot be read or is not named. */
export function deployedReader(assets: AssetsLike, siteUrl: string): () => Promise<string | null> {
  let cached: Promise<string | null> | undefined;
  const read = async (): Promise<string | null> => {
    try {
      const response = await assets.fetch(new Request(`${siteUrl}/site-version.json`));
      if (!response.ok) return null;
      const data: unknown = await response.json();
      const commit = typeof data === "object" && data !== null && "commit" in data ? data.commit : null;
      return typeof commit === "string" && commit !== "" ? commit : null;
    } catch {
      return null;
    }
  };
  return () => (cached ??= read());
}

const minutesBetween = (from: string, to: string): number => Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));

export function statusLine(status: ChangeStatus): string {
  const n = status.change;
  switch (status.state) {
    case "checking":
      return `Change ${n} is being checked. It is not live yet.`;
    case "stuck":
      return `Change ${n} is stuck: a check found a problem (${(status.failedChecks ?? []).join(", ")}). It is not live. Huston Logic can see it on the site's repo; you can withdraw it with undo.`;
    case "going live":
      return `Change ${n} passed its checks and is being published. It is not live yet.${status.unconfirmed ? " I can't confirm it is live yet." : ""}`;
    case "live":
      return `Change ${n} is live. It went live ${status.minutesToLive ?? 0} minutes after it was published.`;
    case "stopped":
      return `Change ${n} was stopped before it went live. Nothing changed on the site.`;
  }
}

export interface StatusReaderDeps {
  config: EditorConfig;
  github: GitHub;
  kv: KVNamespace;
  now: () => Date;
}

export function createStatusReader({ config, github, kv, now }: StatusReaderDeps) {
  async function failedChecks(sha: string): Promise<string[]> {
    const runs = await github.checkRuns(sha);
    return runs.filter((run) => !config.ignoredChecks.includes(run.name) && run.status === "completed" && run.conclusion !== null && FAILED.includes(run.conclusion)).map((run) => run.name);
  }

  async function read(pull: Pull, deployed: () => Promise<string | null>): Promise<ChangeStatus> {
    const base = { change: pull.number, title: changeTitle(pull), publishedAt: pull.createdAt };
    if (pull.state === "open") {
      const failed = await failedChecks(pull.headSha);
      return failed.length > 0 ? { ...base, state: "stuck", failedChecks: failed } : { ...base, state: "checking" };
    }
    if (!pull.merged) return { ...base, state: "stopped" };

    const stored = await kv.get(`live:${pull.number}`, "text");
    if (typeof stored === "string") return { ...base, state: "live", liveAt: stored, minutesToLive: minutesBetween(pull.createdAt, stored) };

    const commit = await deployed();
    if (commit === null || pull.mergeCommitSha === null) return { ...base, state: "going live", unconfirmed: true };
    const relation = await github.compare(pull.mergeCommitSha, commit);
    if (relation !== "identical" && relation !== "ahead") return { ...base, state: "going live" };
    const liveAt = now().toISOString();
    await kv.put(`live:${pull.number}`, liveAt);
    return { ...base, state: "live", liveAt, minutesToLive: minutesBetween(pull.createdAt, liveAt) };
  }

  return { read };
}
