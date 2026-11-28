/**
 * The wording of the gift card emails (design R12). Plain text only, first person singular, template wording for the owner to
 * approve (listed in the PR). Import-free: the Worker bundles it. The only prices are the sale's own amount, passed in
 * already written by the code that knows the currency. Visitor text (names, the message) is passed in as values and appears
 * only as plain text. The owner's own words (how to redeem, the terms line) come from src/content/gift-cards.json.
 */

export type Facts = {
  business: string;
  amount: string;
  code: string;
  redeemWording: string;
  termsLine: string;
  /** "27 November 2027" or null when the card does not expire. */
  validUntil: string | null;
};

const expiry = (validUntil: string | null): string[] => (validUntil ? [`Use it by ${validUntil}.`] : []);

export const giftCardEmails = {
  buyer(v: Facts & { firstName: string; recipientCopy: boolean }): { subject: string; text: string } {
    const lines = [
      v.firstName ? `Hi ${v.firstName},` : "Hi there,",
      `Thank you for buying a gift card from ${v.business}. Your payment of ${v.amount} went through, and the certificate is attached to this email as a PDF.`,
      `The code on it is ${v.code}.`,
      v.redeemWording,
      ...expiry(v.validUntil),
      v.recipientCopy ? "I have also sent a copy to the person you named, so there is nothing more to do." : "You can print the certificate or forward this email when you give it.",
      v.termsLine,
      "If anything looks wrong, reply to this email. It comes straight to me.",
      v.business,
    ];
    return { subject: `Your ${v.business} gift card`, text: lines.join("\n\n") };
  },

  recipient(v: Facts & { to: string; from: string; message: string | null }): { subject: string; text: string } {
    const lines = [
      v.to ? `Hi ${v.to},` : "Hi there,",
      `${v.from} has bought you a gift card from ${v.business}, worth ${v.amount}. The certificate is attached to this email as a PDF.`,
      ...(v.message ? [`Their message:\n${v.message}`] : []),
      `The code on it is ${v.code}.`,
      v.redeemWording,
      ...expiry(v.validUntil),
      v.termsLine,
      v.business,
    ];
    return { subject: `A gift card for you from ${v.from}`, text: lines.join("\n\n") };
  },

  /** The note to the owner for every sale. `ledger` is one block of lines from `ledgerLines`. */
  owner(v: {
    amount: string;
    code: string;
    buyer: string;
    buyerEmail: string;
    recipient: string | null;
    recipientEmail: string | null;
    message: string | null;
    payment: string;
    cameFrom: string;
    buyerEmailState: "sent" | "late";
    recipientState: string;
    ledger: string[];
    webhookMissing: boolean;
    mode: string | null;
  }): { subject: string; text: string } {
    const lines = [
      "A gift card was bought and paid for.",
      "",
      `Amount: ${v.amount}`,
      `Code: ${v.code}`,
      `Bought by: ${v.buyer} <${v.buyerEmail}>`,
      `For: ${v.recipient ?? "(no name given)"}${v.recipientEmail ? ` <${v.recipientEmail}>` : ""}`,
      `Message: ${v.message ?? "(none)"}`,
      `Payment: ${v.payment}`,
      v.cameFrom,
      "",
      v.buyerEmailState === "late"
        ? "Certificate to the buyer: delivered late. The first try failed and you were told; it has now gone through, so you do not need to forward it."
        : "Certificate to the buyer: sent",
      `Certificate to the recipient: ${v.recipientState}`,
      ...v.ledger,
      ...(v.webhookMissing
        ? ["", "Stripe's notice of this payment did not arrive within 90 seconds, so the thank-you page sent the certificate instead. Check the webhook address and events in Stripe (docs/PAYMENTS.md)."]
        : []),
      ...(v.mode ? ["", `Mode: ${v.mode}`] : []),
    ];
    return { subject: `New gift card sold: ${v.amount} from ${v.buyer}`, text: lines.join("\n") };
  },

  /** The urgent note when the buyer's email failed. The certificate is attached when it could be made. */
  alert(v: {
    amount: string;
    code: string;
    buyer: string;
    buyerEmail: string;
    recipient: string | null;
    recipientEmail: string | null;
    message: string | null;
    payment: string;
    attached: boolean;
    ledger: string[];
  }): { subject: string; text: string } {
    const lines = [
      `A gift card of ${v.amount} was paid for, but the email to the buyer did not go through.`,
      v.attached
        ? "The certificate is attached to this email. Forward it to the buyer if it has not arrived within the hour."
        : "The certificate could not be made just now. Stripe will try again for up to three days; until then, contact the buyer and give them the code below.",
      "Stripe keeps retrying for up to three days. If the buyer's email goes through on a retry, you will get a note saying so.",
      "",
      `Amount: ${v.amount}`,
      `Code: ${v.code}`,
      `Bought by: ${v.buyer} <${v.buyerEmail}>`,
      `For: ${v.recipient ?? "(no name given)"}${v.recipientEmail ? ` <${v.recipientEmail}>` : ""}`,
      `Message: ${v.message ?? "(none)"}`,
      `Payment: ${v.payment}`,
      ...v.ledger,
    ];
    return { subject: `Action needed: gift card not delivered (${v.amount} from ${v.buyer})`, text: lines.join("\n") };
  },

  /** One ledger result for the owner's notes. `where` is "Sheet" or "Pipeline app"; `row` is the cells to add by hand, label first. */
  ledgerLines(where: string, state: "saved" | "by-hand" | "skipped", row: { label: string; value: string }[]): string[] {
    if (state === "saved") return [`${where}: saved`];
    if (state === "skipped") return [`${where}: not sent (preview)`];
    return [`${where}: NOT saved - add this row by hand`, ...row.map((cell) => `  ${cell.label}: ${cell.value}`)];
  },
};
