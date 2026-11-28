/**
 * The calendar file attached to the visitor's email (RFC 5545): CRLF line endings, lines folded at 75 octets, one VEVENT per
 * session with times in UTC. Plain `METHOD:PUBLISH`, so a calendar app adds the events without an invitation to answer.
 * https://www.rfc-editor.org/rfc/rfc5545
 */

const encoder = new TextEncoder();

/** Backslash, semicolon, comma and line breaks are escaped in text values (section 3.3.11). */
export function escapeText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/** `20261201T150000Z`. */
export function icsTime(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Folds one line at 75 octets, never inside a character; each continuation starts with one space. */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  let limit = 75;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    if (size + bytes > limit) {
      parts.push(current);
      current = "";
      size = 0;
      limit = 74;
    }
    current += char;
    size += bytes;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

export interface IcsSession {
  start: number;
  end: number;
  summary: string;
  description: string;
}

export function bookingIcs(input: { site: string; host: string; reference: string; now: number; sessions: IcsSession[] }): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${input.site}//Booking//EN`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  input.sessions.forEach((session, index) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${input.reference}-${index}@${input.host}`,
      `DTSTAMP:${icsTime(input.now)}`,
      `DTSTART:${icsTime(session.start)}`,
      `DTEND:${icsTime(session.end)}`,
      `SUMMARY:${escapeText(session.summary)}`,
      `DESCRIPTION:${escapeText(session.description)}`,
      "END:VEVENT",
    );
  });
  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
