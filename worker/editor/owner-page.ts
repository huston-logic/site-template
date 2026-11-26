// The owner page and the sign-in consent page: pure functions, data in and an HTML string out. No scripts, no external
// resources, no style attributes. Every interpolated value goes through escapeHtml.

export interface ThemeColors {
  white: string;
  ink: string;
  ink2: string;
  silver: string;
  silver2: string;
  green: string;
  greenDeep: string;
  rust: string;
  line: string;
  tint: string;
}

export interface PageBase {
  siteName: string;
  siteUrl: string;
  email: string;
  theme: ThemeColors;
}

export interface ProposalView {
  id: string;
  summary: string;
  createdAt: string;
  changeList: string;
  previewLink: string | null;
}

export interface ChangeView {
  change: number;
  title: string;
  state: "checking" | "stuck" | "going live" | "live" | "stopped";
  publishedAt: string;
  liveAt?: string;
  failedChecks?: string[];
}

export interface HomeData extends PageBase {
  /** null when the list could not be read. */
  proposals: ProposalView[] | null;
  changes: ChangeView[] | null;
  /** The site's page that explains what the owner can change, when it has one. */
  lanesUrl?: string | null;
}

export interface ConfirmData extends PageBase {
  proposal: ProposalView;
}

export interface ConsentData extends PageBase {
  handle: string;
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
}

export interface MessageData extends PageBase {
  title: string;
  body: string;
  back?: { href: string; label: string };
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const e = escapeHtml;

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const safeColor = (value: string, fallback: string): string => (HEX.test(value) ? value : fallback);

/** `2026-01-01 12:00 UTC`, the same everywhere. */
export function formatTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const time = (iso: string): string => `<time datetime="${e(iso)}">${e(formatTime(iso))}</time>`;

export function styles(theme: ThemeColors): string {
  const c = (key: keyof ThemeColors, fallback: string): string => safeColor(theme[key], fallback);
  const ink = c("ink", "#1c1917");
  const line = c("line", "#d6d3d1");
  return `
*,*::before,*::after{box-sizing:border-box}
body{margin:0;background:${c("white", "#ffffff")};color:${ink};font:1.0625rem/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:40rem;margin:0 auto;padding:0 1rem}
header{border-bottom:1px solid ${line};padding:1rem 0}
header p{margin:0}
.muted{color:${c("ink2", "#44403c")}}
h1{font-size:1.625rem;line-height:1.25;margin:1.5rem 0 1rem}
h2{font-size:1.25rem;line-height:1.3;margin:2rem 0 .75rem}
a{color:${ink};text-decoration:underline;text-underline-offset:.15em}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid ${c("rust", "#9a3412")};outline-offset:2px}
.skip{position:absolute;left:-999px;top:0;background:${c("white", "#ffffff")};padding:.75rem 1rem;z-index:1}
.skip:focus{left:0}
main{padding-bottom:3rem}
ul,ol{padding:0;margin:0}
.card{border:1px solid ${line};border-radius:8px;padding:1rem;margin:0 0 1rem;list-style:none}
.card h3{font-size:1.0625rem;margin:0 0 .5rem}
.card p{margin:.25rem 0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:${c("silver", "#f5f5f4")};border:1px solid ${line};border-radius:8px;padding:.75rem;margin:.75rem 0;font:.9375rem/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}
code{overflow-wrap:anywhere;background:${c("silver", "#f5f5f4")};border:1px solid ${line};border-radius:4px;padding:.1rem .35rem;font-size:.9375rem}
.actions{display:flex;flex-wrap:wrap;gap:.75rem;margin:1rem 0 0}
.actions form{margin:0}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:.75rem 1.25rem;border-radius:8px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;border:1px solid ${c("line", "#d6d3d1")};background:${c("white", "#ffffff")};color:${ink}}
.btn.primary{background:${c("green", "#1e4fa3")};border-color:${c("green", "#1e4fa3")};color:${c("white", "#ffffff")}}
.btn.primary:hover{background:${c("greenDeep", "#173b7a")}}
.host{font-size:1.25rem;font-weight:700;overflow-wrap:anywhere}
.warn{border:2px solid ${c("rust", "#9a3412")};border-radius:8px;padding:.75rem;margin:1rem 0}
`;
}

export function layout({ title, siteName, email, theme, body }: { title: string; siteName: string; email?: string; theme: ThemeColors; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${e(title)} | ${e(siteName)}</title>
<style>${styles(theme)}</style>
</head>
<body>
<a class="skip" href="#main">Skip to main content</a>
<header>
<div class="wrap">
<p><strong>${e(siteName)}</strong> <span class="muted">Owner page</span></p>
${email ? `<p class="muted">Signed in as ${e(email)}</p>` : ""}
</div>
</header>
<main id="main">
<div class="wrap">
${body}
</div>
</main>
</body>
</html>
`;
}

const wrap = (base: PageBase, title: string, body: string): string => layout({ title, siteName: base.siteName, email: base.email, theme: base.theme, body });

function postForm(action: string, fields: Record<string, string>, label: string, primary: boolean): string {
  const hidden = Object.entries(fields)
    .map(([name, value]) => `<input type="hidden" name="${e(name)}" value="${e(value)}">`)
    .join("");
  return `<form method="post" action="${e(action)}">${hidden}<button class="btn${primary ? " primary" : ""}" type="submit">${e(label)}</button></form>`;
}

const STATE_WORDS: Record<ChangeView["state"], string> = {
  checking: "Being checked, not live yet",
  stuck: "Stuck: a check found a problem, not live",
  "going live": "Passed its checks, going live",
  live: "Live",
  stopped: "Stopped before it went live",
};

function proposalCard(proposal: ProposalView, withReview: boolean): string {
  return `<li class="card">
<h3>${e(proposal.summary)}</h3>
<p class="muted">Prepared ${time(proposal.createdAt)}</p>
<pre>${e(proposal.changeList)}</pre>
${proposal.previewLink ? `<p><a href="${e(proposal.previewLink)}" target="_blank" rel="noopener noreferrer">Open the preview (opens in a new tab)</a></p>` : ""}
${withReview ? `<p><a href="/owner/publish?proposal=${encodeURIComponent(proposal.id)}" aria-label="Review and publish: ${e(proposal.summary)}">Review and publish</a></p>` : ""}
</li>`;
}

function changeItem(change: ChangeView): string {
  const times =
    change.state === "live" && change.liveAt
      ? `Published ${time(change.publishedAt)}, live ${time(change.liveAt)}.`
      : `Published ${time(change.publishedAt)}.`;
  const failed = change.state === "stuck" && change.failedChecks && change.failedChecks.length > 0 ? `<p>Failed: ${e(change.failedChecks.join(", "))}</p>` : "";
  const undo = change.state === "stopped" ? "" : postForm("/owner/undo", { change: String(change.change) }, `Undo change ${change.change}`, false);
  return `<li class="card">
<h3>Change ${e(String(change.change))}: ${e(change.title)}</h3>
<p>${e(STATE_WORDS[change.state])}</p>
<p class="muted">${times}</p>
${failed}
${undo ? `<div class="actions">${undo}</div>` : ""}
</li>`;
}

export function renderOwnerHome(data: HomeData): string {
  const waiting =
    data.proposals === null
      ? `<p>The waiting list could not be loaded right now. Try again in a minute.</p>`
      : data.proposals.length === 0
        ? `<p>Nothing is waiting.</p>`
        : `<ul class="list">${data.proposals.map((p) => proposalCard(p, true)).join("\n")}</ul>`;
  const recent =
    data.changes === null
      ? `<p>The list of changes could not be loaded right now. Try again in a minute.</p>`
      : data.changes.length === 0
        ? `<p>No changes yet.</p>`
        : `<ol class="list">${data.changes.map(changeItem).join("\n")}</ol>`;
  const lanes = data.lanesUrl
    ? `<p><a href="${e(data.lanesUrl)}">What you can change</a> lists the sections you can edit by chatting.</p>`
    : `<p>Ask your AI app for the editing guide (it is the get_editing_guide tool) to see what you can change by chatting and what needs Huston Logic.</p>`;
  const body = `<h1>Your site</h1>
<h2>Waiting for your yes</h2>
${waiting}
<h2>Recent changes</h2>
${recent}
<h2>Connect your AI app</h2>
<p>The connector address is <code>${e(data.siteUrl)}/mcp</code></p>
<p>For Claude: Settings, Connectors, Add custom connector, paste the address, Connect, sign in with the code sent to your email, then Allow.</p>
<p>Other AI apps that support connectors with sign-in work the same way.</p>
<h2>What you can change</h2>
${lanes}`;
  return wrap(data, "Owner page", body);
}

export function renderConfirm(data: ConfirmData): string {
  const p = data.proposal;
  const body = `<h1>Publish this change?</h1>
<p>${e(p.summary)}</p>
<pre>${e(p.changeList)}</pre>
${p.previewLink ? `<p><a href="${e(p.previewLink)}" target="_blank" rel="noopener noreferrer">Open the preview (opens in a new tab)</a></p>` : ""}
<div class="actions">
${postForm("/owner/publish", { proposal: p.id }, "Publish", true)}
${postForm("/owner/discard", { proposal: p.id }, "Discard", false)}
</div>
<p><a href="/owner">Back to the owner page</a></p>`;
  return wrap(data, "Publish this change?", body);
}

export function renderConsent(data: ConsentData): string {
  const title = `Allow ${data.clientName} to edit ${data.siteName}?`;
  const domain = data.clientDomain ? `<p>Its verified domain is <strong>${e(data.clientDomain)}</strong>.</p>` : "";
  const warn = data.redirectIsLoopback
    ? `<p class="warn"><strong>Warning:</strong> this sends your sign-in to an app running on this computer. Only continue if you started it yourself.</p>`
    : "";
  const body = `<h1>${e(title)}</h1>
<p class="host">It will send its sign-in to ${e(data.redirectHost)}.</p>
${domain}
${warn}
<p>It can read your pages and propose changes. Nothing goes live until you say yes in the chat.</p>
<form method="post" action="/owner/connect">
<input type="hidden" name="handle" value="${e(data.handle)}">
<div class="actions">
<button class="btn primary" type="submit" name="decision" value="allow">Allow</button>
<button class="btn" type="submit" name="decision" value="deny">Don't allow</button>
</div>
</form>`;
  return wrap(data, title, body);
}

export function renderMessage(data: MessageData): string {
  const back = data.back ?? { href: "/owner", label: "Back to the owner page" };
  const body = `<h1>${e(data.title)}</h1>
<p>${e(data.body).replace(/\n/g, "<br>")}</p>
<p><a href="${e(back.href)}">${e(back.label)}</a></p>`;
  return wrap(data, data.title, body);
}
