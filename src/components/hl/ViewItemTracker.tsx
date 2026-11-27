"use client";

import { useEffect, useRef } from "react";
import { track } from "@/tracking/track";

/** Reports `view_item` once per view of a piece's page (item id and name only; no price). Draws nothing. */
export function ViewItemTracker({ slug, name }: { slug: string; name: string }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    track("view_item", { item_id: slug, item_name: name });
  }, [slug, name]);
  return null;
}
