import { siteConfig } from "@/content/site";
import { getSiteContent } from "@/lib/site-content";
import { rssFeed } from "@/lib/feed";
import { collectionFor } from "@/collections/definitions";
import { sortItems } from "@/collections/validate";

export const dynamic = "force-static";

/** /blog/feed.xml: RSS 2.0 with live posts only, newest first. Drafts never reach the feed, in any build. */
export function GET(): Response {
  const def = collectionFor("posts");
  const live = getSiteContent().items.filter((item) => item.kind === "posts" && item.status === "live");
  const posts = def === undefined ? live : sortItems(def, live);
  const xml = rssFeed({ site: { name: siteConfig.name, description: siteConfig.oneLiner, url: siteConfig.url }, posts });
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
