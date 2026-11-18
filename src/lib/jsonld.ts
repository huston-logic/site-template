import { siteConfig } from "@/content/site";

/** Facts only from the site config: name, URL, what the business does, and the founder. */
export function organizationJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${siteConfig.url}/#business`,
    name: siteConfig.name,
    url: siteConfig.url,
    description: siteConfig.oneLiner,
    founder: { "@type": "Person", name: siteConfig.founder },
  };
}
