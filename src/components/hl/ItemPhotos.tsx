"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cardPathFor } from "@/catalog/schema";
import type { ItemPhoto } from "./catalog-data";
import { catalogWords } from "@/content/catalog";
import { PhotoStrip, usePhotoStrip } from "./PhotoStrip";
import { PhotoViewer, type PhotoViewerHandle } from "./PhotoViewer";

const SIZES = "(min-width: 900px) 58vw, 100vw";

/**
 * A piece's photos: one large photo in a square frame, shown whole (object-contain on the tint mat) so nothing is cut off. A
 * piece with several photos swipes through them (the browser's own scroll snapping, no touch handler) and shows up to six
 * thumbnails, the small card files, that follow the swipe. The first photo loads at once and is the page's largest first-screen
 * image; the others load when they start to show. No carousel, no autoplay.
 */
export function ItemPhotos({ photos, name }: { photos: readonly ItemPhoto[]; /** The piece's name, for the closer look's label. */ name: string }) {
  const [only] = photos;
  if (only === undefined) return null;
  if (photos.length === 1) return <OnePhoto photo={only} />;
  return <SeveralPhotos photos={photos} name={name} />;
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

function SeveralPhotos({ photos, name }: { photos: readonly ItemPhoto[]; name: string }) {
  const strip = usePhotoStrip();
  const { index, select } = strip;
  const viewer = useRef<PhotoViewerHandle>(null);
  const openers = useRef<(HTMLButtonElement | null)[]>([]);
  const [returned, setReturned] = useState<{ at: number } | null>(null);

  // After the closer look closes, focus goes back to the button that opens the photo last seen. That is the opening button
  // unless the visitor stepped to another photo, whose slot is the one in view (the others are inert).
  useEffect(() => {
    if (returned !== null) openers.current[returned.at]?.focus({ preventScroll: true });
  }, [returned]);

  return (
    <div>
      <PhotoStrip
        photos={photos}
        strip={strip}
        sizes={SIZES}
        className="relative aspect-square w-full rounded-card bg-tint"
        preloadFirst
        overlay={(position, photo) => (
          <button
            type="button"
            ref={(element) => {
              openers.current[position] = element;
            }}
            aria-label={catalogWords.openLarge(position + 1, photos.length, photo.alt)}
            onClick={() => viewer.current?.open(position)}
            className="absolute inset-0 z-10 h-full w-full cursor-zoom-in focus-visible:-outline-offset-4"
          />
        )}
      />
      <PhotoViewer
        ref={viewer}
        photos={photos}
        name={name}
        onClose={(last) => {
          select(last, true);
          setReturned({ at: last });
        }}
      />
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
