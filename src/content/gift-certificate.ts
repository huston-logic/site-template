/**
 * The fixed words on the gift certificate PDF (worker/gift-cards/certificate.ts). Template wording: CLIENT, adjust per
 * site. Import-free, because the Worker bundles it. `{name}`, `{date}` and `{business}` are filled by the layout; the
 * amount, code, names, message, redeem wording and terms come from the sale and from src/content/gift-cards.json.
 */
export const giftCertificateCopy = {
  /** The small letter-spaced line at the top; the layout sets it in capitals. */
  eyebrow: "Gift certificate",
  /** The big italic line when the buyer named a recipient. */
  giftFor: "A gift for {name}",
  /** The same line with no recipient. */
  giftForAnyone: "A gift for you",
  from: "From {name}",
  codeLabel: "Code",
  issued: "Issued {date}",
  validUntil: "Valid until {date}",
  noExpiry: "No expiry date",
  /** The PDF's document title (shown in a reader's title bar). */
  documentTitle: "Gift certificate from {business}",
} as const;
