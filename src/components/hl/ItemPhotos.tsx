"use client";

import Image from "next/image";
import { cardPathFor } from "@/catalog/schema";
import type { ItemPhoto } from "./catalog-data";
import { catalogWords } from "@/content/catalog";
import { PhotoStrip, usePhotoStrip } from "./PhotoStrip";

const SIZES = "(min-width: 900px) 58vw, 100vw";

/**
 * A piece's photos: one large photo in a square frame, shown whole (object-contain on the tint mat) so nothing is cut off. A
 * piece with several photos swipes through them (the browser's own scroll snapping, no touch handler) and shows up to six
 * thumbnails, the small card files, that follow the swipe. The first photo loads at once and is the page's largest first-screen
 * image; the others load when they start to show. No carousel, no autoplay.
 */
export function ItemPhotos({ photos }: { photos: readonly ItemPhoto[] }) {
  const [only] = photos;
  if (only === undefined) return null;
  if (photos.length === 1) return <OnePhoto photo={only} />;
  return <SeveralPhotos photos={photos} />;
}

function OnePhoto({ photo }: { photo: ItemPhoto }) {
  return (
    <div>
      <div className="relative aspect-square w-full overflow-hidden rounded-card bg-tint">
        <Image src={photo.src} alt={photo.alt} fill sizes={SIZES} className="object-contain" preload fetchPriority="high" />
      </div>
    </div>
  );
}

function SeveralPhotos({ photos }: { photos: readonly ItemPhoto[] }) {
  const strip = usePhotoStrip();
  const { index, select } = strip;
  return (
    <div>
      <PhotoStrip photos={photos} strip={strip} sizes={SIZES} className="relative aspect-square w-full rounded-card bg-tint" preloadFirst />
      <noscript>
        <ul role="list" className="mt-4 flex flex-wrap gap-x-6">
          {photos.slice(1).map((photo, position) => (
            <li key={`${photo.src}-${position}`}>
              <a href={photo.src} className="inline-flex min-h-11 items-center font-ui font-medium text-green underline underline-offset-quarter-em">
                {catalogWords.photoLink(position + 2, photos.length)}
              </a>
            </li>
          ))}
        </ul>
      </noscript>
      <div className="hl-js-only">
        <ul role="list" aria-label={catalogWords.photos} className="mt-4 grid grid-cols-6 gap-2.5">
          {photos.map((photo, position) => (
            <li key={`${photo.src}-${position}`}>
              <button
                type="button"
                aria-pressed={position === index}
                aria-label={catalogWords.photo(position + 1, photos.length, photo.alt)}
                onClick={() => select(position)}
                className={`relative block aspect-photo-4-5 w-full overflow-hidden rounded-field border-2 bg-tint ${position === index ? "border-ink" : "border-transparent"}`}
              >
                <Image src={cardPathFor(photo.src)} alt="" fill sizes="96px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
