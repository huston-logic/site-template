export type CertificateInput = {
  businessName: string; siteHost: string; amountText: string; code: string;
  to: string | null; from: string; message: string | null;
  redeemWording: string; termsLine: string; issuedOn: string; validUntil: string | null;
  colors: { green: string; ink: string; ink2: string; rust: string; line: string };
};
export type CertificateAssets = { display: Uint8Array; displayBold: Uint8Array; accent: Uint8Array; logo: { png: Uint8Array } | null };
