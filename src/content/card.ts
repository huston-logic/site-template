import { siteConfig as base } from "../../site.config";
import { siteConfig } from "./site";

/**
 * The NFC business card at /card and the contact file at /grant.vcf. Copy: Grant's brief for the card (Nov 16, 2026),
 * not docs/website-plan.md Section B. The page is noindex and stays out of the nav and the sitemap.
 */
export const card = {
  meta: {
    title: `${base.owner.name} | ${base.business.name}`,
    description: `${base.owner.name}, ${base.owner.role}, ${base.business.name}. Personal websites and software.`,
  },
  name: base.owner.name,
  givenName: base.owner.givenName,
  familyName: base.owner.familyName,
  jobTitle: base.owner.role,
  role: `${base.owner.role}, ${base.business.name}`,
  lines: ["Personal websites and software", "For the parts of the job you never signed up for"] as const,
  /** Grant's mobile number, in international format for `tel:`, `sms:` and the vCard. */
  phone: base.owner.phone,
  email: siteConfig.email,
  saveLabel: "Save my contact ↓",
  vcardPath: base.owner.vcardPath,
  vcardFileName: base.owner.vcardFileName,
  actions: { call: "Call", text: "Text", email: "Email" },
  links: [
    { label: "See my work →", href: "/" },
    { label: "Start a project →", href: "/contact" },
  ],
};
