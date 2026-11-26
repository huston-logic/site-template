import { needOptions } from "../src/content/contact-fields.ts";
import type { ContactSubmission } from "../src/lib/contact-validation.ts";
import { autoReplyFirstName } from "../src/lib/first-name.ts";
import type { Destination, WorkerConfig } from "./config.ts";
import type { Mode, SaveStatus } from "./env.ts";
import { escapeHtml } from "./html.ts";

/** The most characters the Pipeline app accepts in `message`. */
const PIPELINE_MESSAGE_MAX = 5000;

/** "A website", "Help with a workflow", ... or "Partner" for the partner variant (it has no need field). */
export function needLabel(submission: ContactSubmission): string {
  if (submission.topic === "partner") return "Partner";
  return needOptions.find((option) => option.value === submission.need)?.label ?? "";
}

function cap(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function previewPrefix(mode: Mode): string {
  return mode === "production" ? "" : "[Preview] ";
}

/** The notification line that says whether the contact reached its destination, so the owner knows when to add it by hand. */
function saveLine(destination: Destination, status: SaveStatus): string {
  const where = destination === "pipeline" ? "Pipeline app" : "Sheet";
  if (status === "saved") return `${where}: saved`;
  if (status === "skipped") return `${where}: not sent (preview)`;
  return `${where}: NOT saved - add this one by hand`;
}

/** The internal email to the site owner: plain text, every field labelled, plus whether the Sheet row or the app lead was saved. */
export function notificationEmail(config: WorkerConfig, s: ContactSubmission, mode: Mode, receivedAt: string, status: SaveStatus) {
  const subject = cap(`${previewPrefix(mode)}New note: ${needLabel(s)} from ${s.name}`, 120);
  const lines = [
    `Need: ${needLabel(s)}`,
    `Topic link: ${s.topic || "(none)"}`,
    `Name: ${s.name}`,
    `Email: ${s.email}`,
    `Business:${s.business || "(not given)"}`,
    `Uses today: ${s.tools || "(not given)"}`,
    `Current website: ${s.website || "(not given)"}`,
    `Heard about ${config.businessName}: ${s.source || "(not given)"}`,
    "",
    "What's going on:",
    s.message,
    "",
    `Received: ${receivedAt}`,
    saveLine(config.destination, status),
  ];
  if (mode !== "production") lines.push(`Mode: ${mode}`);
  return { subject, text: lines.join("\n") };
}

/** The B7b automatic reply. In preview it goes to the site owner instead, and the subject says who it would have gone to. */
export function autoReplyEmail(config: WorkerConfig, s: ContactSubmission, mode: Mode, bookingUrl: string) {
  const { autoReply } = config;
  const name = autoReplyFirstName(s.name);
  const { booking } = autoReply;
  const greeting = name ? autoReply.greeting.replace("{firstName}", name) : autoReply.greetingNoName;
  const text = [
    greeting,
    ...autoReply.paragraphs,
    `${booking.before}${booking.linkText}${booking.after}\n${bookingUrl}`,
    ...autoReply.paragraphsAfter,
    autoReply.talkSoon,
    autoReply.signatureText.join("\n").replace("{bookingUrl}", bookingUrl),
  ].join("\n\n");

  const { ink, link: linkColor } = autoReply.colors;
  const p = (inner: string) => `<p style="margin:0 0 16px;">${inner}</p>`;
  const link = `<a href="${escapeHtml(bookingUrl)}" style="color:${escapeHtml(linkColor)};">${escapeHtml(booking.linkText)}</a>`;
  const html = [
    `<div style="max-width:560px;margin:0;text-align:left;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:${escapeHtml(ink)};">`,
    p(escapeHtml(greeting)),
    ...autoReply.paragraphs.map((t) => p(escapeHtml(t))),
    p(`${escapeHtml(booking.before)}${link}${escapeHtml(booking.after)}`),
    ...autoReply.paragraphsAfter.map((t) => p(escapeHtml(t))),
    p(escapeHtml(autoReply.talkSoon)),
    autoReply.signatureHtml.replace("{bookingUrl}", escapeHtml(bookingUrl)),
    "</div>",
  ].join("\n");

  const subject = mode === "production" ? autoReply.subject : `[Preview → would go to ${s.email}] ${autoReply.subject}`;
  return { subject, text, html };
}

/**
 * The Pipeline app has name, email, message, business and source only, so the other answers travel inside the message:
 * the visitor's own words first, then one labelled line per answer given. Capped at the app's 5,000 characters.
 */
export function pipelineMessage(config: WorkerConfig, s: ContactSubmission): string {
  const extras = [
    ["Need", needLabel(s)],
    ["Topic link", s.topic],
    ["Uses today", s.tools],
    ["Current website", s.website],
    [`Heard about ${config.businessName}`, s.source],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`);
  return cap(extras.length > 0 ? `${s.message}\n\n${extras.join("\n")}` : s.message, PIPELINE_MESSAGE_MAX);
}

/** The Sheet row, in the header order: Received, Need, Topic, Name, Email, Business, Message, Tools, Website, Source, Mode. */
export function sheetRow(s: ContactSubmission, mode: Mode, receivedAt: string): string[] {
  return [receivedAt, needLabel(s), s.topic, s.name, s.email, s.business, s.message, s.tools, s.website, s.source, mode];
}
