import { needOptions } from "../src/content/contact-fields.ts";
import { formWords } from "../src/content/forms.ts";
import { answerLines, emailOf, nameOf, organizationOf, type AnswerLine } from "../src/forms/answers.ts";
import type { FormDefinition, FormDownload } from "../src/forms/schema.ts";
import type { SubmissionValue } from "../src/forms/submission.ts";
import type { ContactSubmission } from "../src/lib/contact-validation.ts";
import { autoReplyFirstName } from "../src/lib/first-name.ts";
import type { Destination, WorkerConfig } from "./config.ts";
import type { Mode, SaveStatus } from "./env.ts";
import { escapeHtml } from "./html.ts";
import type { PipelineLead } from "./pipeline.ts";
import { safeCell } from "./sheets.ts";

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

/** The most characters one Sheet cell takes (the Apps Script refuses more). */
const SHEET_CELL_MAX = 6000;
const ANSWERS_CUT = "\n(cut; the notification email has every answer)";

function answerText(line: AnswerLine): string {
  return line.text.includes("\n") ? `${line.label}:\n${line.text}` : `${line.label}: ${line.text}`;
}

/** The "Answers" cell: one `Label: value` line per answer given, cut with a fixed ending past the cell limit. */
function answersCell(lines: AnswerLine[]): string {
  const text = lines.map(answerText).join("\n");
  // safeCell may add a leading apostrophe on the way out, and the Apps Script refuses a cell over the limit: leave room for it.
  const room = SHEET_CELL_MAX - (safeCell(text) === text ? 0 : 1);
  return text.length > room ? `${text.slice(0, room - ANSWERS_CUT.length)}${ANSWERS_CUT}` : text;
}

/** The Forms tab row, one fixed header for every form: Received (UTC), Form, Name, Email, Answers, Mode. */
export function formSheetRow(def: FormDefinition, value: SubmissionValue, mode: Mode, receivedAt: string): string[] {
  return [receivedAt, def.name, nameOf(def, value), emailOf(def, value), answersCell(answerLines(def, value)), mode];
}

/** The Pipeline lead: the name field or, without one, the email address; the answers travel in the message. */
export function formPipelineLead(def: FormDefinition, value: SubmissionValue): PipelineLead {
  const email = emailOf(def, value);
  const message = cap(`Form: ${def.name}\n\n${answerLines(def, value).map(answerText).join("\n")}`, PIPELINE_MESSAGE_MAX);
  const business = organizationOf(def, value);
  return { name: nameOf(def, value) || email, email, message, ...(business ? { business } : {}) };
}

/** The internal email for a form: plain text, every answer labelled, whether it was saved, and the mode when not live. */
export function formNotificationEmail(config: WorkerConfig, def: FormDefinition, value: SubmissionValue, mode: Mode, receivedAt: string, status: SaveStatus) {
  const who = nameOf(def, value) || emailOf(def, value);
  const subject = cap(`${previewPrefix(mode)}New ${def.name} from ${who}`, 120);
  const lines = [`Form: ${def.name}`, "", ...answerLines(def, value).map(answerText), "", `Received: ${receivedAt}`, saveLine(config.destination, status)];
  if (mode !== "production") lines.push(`Mode: ${mode}`);
  return { subject, text: lines.join("\n") };
}

/**
 * The download email: plain text, fixed words (src/content/forms.ts) plus the owner's title, the business name and the
 * link built from the site's own address. No visitor input appears in it; in preview only the subject names who it would
 * have gone to, as the automatic reply does.
 */
export function downloadEmail(config: WorkerConfig, download: FormDownload, mode: Mode, visitorEmail: string) {
  const fill = (text: string) => text.replaceAll("{title}", download.title);
  const [intro, before] = formWords.download.lines;
  const text = [fill(intro ?? ""), `${fill(before ?? "")}\n${config.editor.siteUrl}${download.href}`, config.businessName].join("\n\n");
  const base = fill(formWords.download.subject);
  return { subject: mode === "production" ? base : `[Preview → would go to ${visitorEmail}] ${base}`, text };
}
