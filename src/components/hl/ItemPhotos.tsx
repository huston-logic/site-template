"use client";

import Image from "next/image";
import { useState } from "react";
import { cardPathFor } from "@/catalog/schema";
import type { ItemPhoto } from "./catalog-data";
import { itemWords } from "./catalog-words";

/**
 * A piece's photos: one large photo in a 4:5 frame, shown whole (object-contain on the tint mat) so nothing is cut off, and
 * up to six thumbnails. The first photo loads at once and is the page's largest first-screen image; the others load only
 * when chosen, and the thumbnails are the small card files. No carousel, no autoplay, no swipe handler: buttons only.
 */
export function ItemPhotos({ photos }: { photos: readonly ItemPhoto[] }) {
  const [index, setIndex] = useState(0);
  const current = photos[index] ?? photos[0];
  if (current === undefined) return null;
  return (
    <div>
      <div className="relative aspect-photo-4-5 w-full overflow-hidden rounded-card bg-tint">
        <Image key={index} src={current.src} alt={current.alt} fill sizes="(min-width: 900px) 58vw, 100vw" className="object-contain" preload={index === 0} />
      </div>
      {photos.length > 1 ? (
        <div className="hl-js-only">
          <ul role="list" aria-label={itemWords.photos} className="mt-4 grid grid-cols-6 gap-2.5">
            {photos.map((photo, position) => (
              <li key={`${photo.src}-${position}`}>
                <button
                  type="button"
                  aria-pressed={position === index}
                  aria-label={itemWords.photo(position + 1, photos.length, photo.alt)}
                  onClick={() => setIndex(position)}
                  className={`relative block aspect-photo-4-5 w-full overflow-hidden rounded-field border-2 bg-tint ${position === index ? "border-ink" : "border-transparent"}`}
                >
                  <Image src={cardPathFor(photo.src)} alt="" fill sizes="96px" className="object-cover" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
