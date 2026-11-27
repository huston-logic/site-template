import { TrackingTags } from "@/components/tracking/TrackingTags";
import { siteConfig } from "../../site.config";
import { trackingForBuild } from "./config";

// Used in place of ./tags-slot.tsx only when the build has tags (see next.config.ts).
const tags = trackingForBuild(siteConfig, process.env);

export function TagsSlot() {
  return tags ? <TrackingTags ids={tags.ids} host={tags.host} /> : null;
}
