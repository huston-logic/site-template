import { log, retryable, TIMEOUT_MS } from "./env.ts";

const RESEND = "https://api.resend.com/emails";

export type OutgoingEmail = {
  from: string;
  to: string;
  replyTo: string;
  subject: string;
  text: string;
  /** Only the automatic reply sends HTML: a fixed template where the one visitor value (first name) is escaped. */
  html?: string;
  headers?: Record<string, string>;
  /** Gift card emails only: the certificate PDF. `content` is base64. */
  attachments?: { filename: string; content: string }[];
};

/**
 * Sends one email through Resend. Retries once on a rate limit, server error or network failure; the idempotency key
 * makes sure a retry can't send the same email twice. Returns whether Resend accepted it.
 */
export async function sendEmail(apiKey: string | undefined, email: OutgoingEmail, idempotencyKey: string, kind: string): Promise<boolean> {
  if (!apiKey) {
    log("email_config_missing", { kind });
    return false;
  }
  const body = JSON.stringify({ from: email.from, to: [email.to], reply_to: email.replyTo, subject: email.subject, text: email.text, ...(email.html ? { html: email.html } : {}), ...(email.headers ? { headers: email.headers } : {}), ...(email.attachments ? { attachments: email.attachments } : {}) });
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const response = await fetch(RESEND, {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "idempotency-key": idempotencyKey },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return true;
      // Resend answers 409 when this idempotency key was already used (a different body, as the owner's note can be, or a
      // request still in flight): the email was accepted before, so it is not sent again and not retried.
      if (response.status === 409) {
        log("email_duplicate", { kind });
        return true;
      }
      log("email_failed", { kind, status: response.status, attempt });
      if (!retryable(response.status)) return false;
    } catch {
      log("email_unreachable", { kind, attempt });
    }
  }
  return false;
}
