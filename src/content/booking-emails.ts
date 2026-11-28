/**
 * The wording of the booking emails (booking design R11, R12, R13). Plain text only, first person singular, template
 * wording for the owner to approve (listed in the PR). Import-free: the Worker bundles it. Money, dates and times arrive
 * already written by the code that knows the currency and the business's zone. Visitor text (name, notes) is passed in
 * as values and appears only as plain text. The owner's own words (policy, how to change a booking) come from
 * src/content/booking.json.
 */

export type Facts = {
  business: string;
  service: string;
  reference: string;
  party: number;
  /** One line per session, like "Session 1 of 2: Tuesday, December 1, 2026, 9:00 AM". A single session has just the time. */
  sessions: string[];
  /** "Central Standard Time": every time in the email is in it. */
  zoneName: string;
  /** "$112.50", or "" when nothing was paid online. */
  paid: string;
  /** "$337.50", or "" when nothing is due later. */
  dueLater: string;
  item: string | null;
};

export type Person = { name: string; email: string; phone: string };

const sessionsBlock = (v: Facts): string => v.sessions.join("\n");
const partyLine = (v: Facts): string[] => (v.party > 1 ? [`Party size: ${v.party}`] : []);
const moneyLines = (v: Facts): string[] => [...(v.paid ? [`Paid now: ${v.paid}`] : []), ...(v.dueLater ? [`Still to pay: ${v.dueLater}`] : [])];
const itemLine = (v: Facts): string[] => (v.item ? [`For: ${v.item}`] : []);

const detailsBlock = (v: Facts): string => [`${v.service}`, sessionsBlock(v), ...partyLine(v), ...moneyLines(v), ...itemLine(v), `Reference: ${v.reference}`].join("\n");

export const bookingEmails = {
  /** To the visitor when the calendar holds their time. The calendar file is attached. */
  visitor(v: Facts & { firstName: string; changeWording: string; policy: string }): { subject: string; text: string } {
    const lines = [
      v.firstName ? `Hi ${v.firstName},` : "Hi there,",
      v.paid ? `Thank you. Your payment of ${v.paid} went through and your booking with ${v.business} is confirmed.` : `Thank you. Your booking with ${v.business} is confirmed.`,
      detailsBlock(v),
      "The attached file will add it to your calendar.",
      v.changeWording,
      v.policy,
      "If anything looks wrong, reply to this email. It comes straight to me.",
      v.business,
    ];
    return { subject: `Your booking with ${v.business}`, text: lines.join("\n\n") };
  },

  /** To the visitor who paid when the time could not be written to the calendar: no confirmation, a promise to be in touch. */
  waiting(v: Facts & { firstName: string; changeWording: string }): { subject: string; text: string } {
    const lines = [
      v.firstName ? `Hi ${v.firstName},` : "Hi there,",
      `Thank you. Your payment${v.paid ? ` of ${v.paid}` : ""} went through, but I could not confirm your time automatically.`,
      "I will contact you myself about your booking. Please do not book again.",
      detailsBlock(v),
      v.changeWording,
      "If you would like to reach me sooner, reply to this email. It comes straight to me.",
      v.business,
    ];
    return { subject: `Your payment to ${v.business}: I will be in touch about your time`, text: lines.join("\n\n") };
  },

  /** The note to the owner for every booking. `ledger` is one block of lines from `ledgerLines`. */
  owner(v: Facts & Person & { notes: string[]; cameFrom: string; payment: string; visitorState: "sent" | "not-sent"; ledger: string[]; late: boolean; repairedByThanksPage: boolean; mode: string | null }): { subject: string; text: string } {
    const lines = [
      `New booking: ${v.service} for ${v.name || v.email}`,
      "",
      detailsBlock(v),
      "",
      `Name: ${v.name}`,
      `Email: ${v.email}`,
      ...(v.phone ? [`Phone: ${v.phone}`] : []),
      ...(v.notes.length > 0 ? ["", ...v.notes] : []),
      "",
      v.cameFrom,
      `Payment: ${v.payment}`,
      v.visitorState === "sent" ? "Confirmation to the visitor: sent, with a calendar file" : "Confirmation to the visitor: NOT sent yet. I will try again by itself; if it has not arrived, write to them.",
      ...v.ledger,
      ...(v.late ? ["", "This booking was written to the calendar late, after a first attempt failed. Check that the time is right."] : []),
      ...(v.repairedByThanksPage ? ["", "The payment service's notice never arrived, so the visitor's thank-you page finished this booking."] : []),
      "",
      "To change it, move or delete the event in your calendar. Refunds are made in Stripe.",
      ...(v.mode ? ["", `Mode: ${v.mode}`] : []),
    ];
    return { subject: `New booking: ${v.service} for ${v.name || v.email}`, text: lines.join("\n") };
  },

  /** The alert when someone has paid and the calendar does not hold their time. It carries the whole booking, so nothing is lost. */
  alert(v: Facts & Person & { notes: string[]; payment: string; why: "clash" | "failed"; ledger: string[] }): { subject: string; text: string } {
    const reason =
      v.why === "clash"
        ? "Someone paid, but the time they chose is no longer free: another event is on the calendar then, or their hold was removed. The sessions I could still keep are on your calendar titled CHECK."
        : "Someone paid, but I could not write their time to your calendar (Google did not answer). I will keep trying; you will get a normal booking note if it works.";
    const lines = [
      "ACTION NEEDED: a paid booking needs you.",
      reason,
      "",
      detailsBlock(v),
      "",
      `Name: ${v.name}`,
      `Email: ${v.email}`,
      ...(v.phone ? [`Phone: ${v.phone}`] : []),
      ...(v.notes.length > 0 ? ["", ...v.notes] : []),
      "",
      `Payment: ${v.payment}`,
      "They have been told you will contact them about their time.",
      ...v.ledger,
      "",
      v.why === "clash" ? "What to do: write to them to agree a new time, then put it in your calendar. If it cannot work, refund the payment in Stripe." : "What to do: if this note is the last you hear of it, add the booking to your calendar yourself and write to them.",
    ];
    return { subject: `ACTION NEEDED: paid booking for ${v.name || v.email}`, text: lines.join("\n") };
  },

  /** Money was taken and the amount does not match what the Worker asked for: nothing is booked. */
  mismatch(v: { amount: string; expected: string; payment: string }): { subject: string; text: string } {
    return {
      subject: "ACTION NEEDED: a booking payment did not match",
      text: [
        `A payment of ${v.amount} came in for a booking, but I expected ${v.expected}. I have not confirmed any time.`,
        `Payment: ${v.payment}`,
        "Look at it in Stripe and write to the visitor.",
      ].join("\n\n"),
    };
  },

  /** What the owner's note says about the ledger. `cells` is the row cell by cell, used only when it could not be saved. */
  ledgerLines(where: "Sheet" | "Pipeline app", state: "saved" | "skipped" | "by-hand", cells: { label: string; value: string }[]): string[] {
    if (state === "saved") return [`${where}: saved`];
    if (state === "skipped") return [`${where}: not saved (this is a preview)`];
    return [`${where}: NOT saved. Please add this row by hand:`, ...cells.map((cell) => `  ${cell.label}: ${cell.value}`)];
  },
};
