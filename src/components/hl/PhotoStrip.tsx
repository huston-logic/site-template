"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ItemPhoto } from "./catalog-data";

const noSubscription = () => () => {};
/** False in the server HTML and while hydrating, true afterwards, so the first paint matches the server's. */
const useHydrated = () => useSyncExternalStore(noSubscription, () => true, () => false);

/** How long a press on a thumbnail or an arrow ignores the strip's own idea of the current photo while it scrolls there. */
const AIM_MS = 1000;

/**
 * The state of a row of photos that swipes natively (scroll snapping). An IntersectionObserver reads which photo is in view,
 * so no touch or wheel listener exists, and it also says which photos have come into view, so full photos load one at a time.
 * `initial` is the photo to show first (the large view opens on the one the visitor chose).
 */
export function usePhotoStrip(initial = 0) {
  const stripRef = useRef<HTMLDivElement>(null);
  const aim = useRef<{ index: number; until: number } | null>(null);
  const [index, setIndex] = useState(initial);
  const [loaded, setLoaded] = useState<ReadonlySet<number>>(() => new Set([initial]));
  const hydrated = useHydrated();

  const reveal = useCallback((position: number) => setLoaded((before) => (before.has(position) ? before : new Set(before).add(position))), []);

  /** Chooses a photo and scrolls the strip to it: smoothly unless the visitor prefers reduced motion (CSS decides), or at once when `instant`. */
  const select = useCallback(
    (position: number, instant = false) => {
      setIndex(position);
      reveal(position);
      const strip = stripRef.current;
      if (!strip) return;
      const left = position * strip.clientWidth;
      if (Math.abs(strip.scrollLeft - left) < 1) {
        aim.current = null;
        return;
      }
      aim.current = { index: position, until: performance.now() + AIM_MS };
      strip.scrollTo(instant ? { left, behavior: "instant" } : { left });
    },
    [reveal],
  );

  useEffect(() => {
    const strip = stripRef.current;
    if (!hydrated || !strip) return;
    if (initial > 0) strip.scrollTo({ left: initial * strip.clientWidth, behavior: "instant" });
    const observer = new IntersectionObserver(
      (entries) => {
        let current = -1;
        for (const entry of entries) {
          const position = Number((entry.target as HTMLElement).dataset["slide"]);
          if (entry.intersectionRatio > 0) reveal(position);
          if (entry.intersectionRatio >= 0.6) current = position;
        }
        if (current < 0) return;
        const goal = aim.current;
        if (goal && performance.now() < goal.until && current !== goal.index) return;
        aim.current = null;
        setIndex(current);
      },
      { root: strip, threshold: [0.01, 0.6] },
    );
    for (const slide of strip.children) observer.observe(slide);
    return () => observer.disconnect();
  }, [hydrated, initial, reveal]);

  return { stripRef, index, loaded, hydrated, select };
}

export type PhotoStripState = ReturnType<typeof usePhotoStrip>;

type StripProps = {
  photos: readonly ItemPhoto[];
  strip: PhotoStripState;
  sizes: string;
  /** The frame's own classes (size, shape, background). */
  className: string;
  /** True on the piece page, where the first photo is the largest first-screen image. */
  preloadFirst?: boolean;
  /** Drawn over each photo once the page is interactive. */
  overlay?: (position: number) => ReactNode;
  /** Makes the strip a keyboard stop, for a strip with nothing else in it to focus. */
  focusable?: { label: string };
};

/**
 * The photos as one row, each a full slot of the frame. Before hydration only the first is drawn, so the server's page is the
 * single square frame; afterwards every slot exists, and a slot's full photo mounts when it first shows (or is chosen) and stays.
 */
export function PhotoStrip({ photos, strip, sizes, className, preloadFirst = false, overlay, focusable }: StripProps) {
  const { stripRef, index, loaded, hydrated } = strip;
  const shown = hydrated ? photos : photos.slice(0, 1);
  return (
    <div
      ref={stripRef}
      className={`hl-strip flex snap-x snap-mandatory overflow-x-auto overflow-y-hidden ${className}`}
      tabIndex={focusable ? 0 : undefined}
      role={focusable ? "group" : undefined}
      aria-label={focusable?.label}
    >
      {shown.map((photo, position) => (
        <div key={position} data-slide={position} inert={hydrated && position !== index} className="relative h-full w-full shrink-0 snap-center snap-always">
          {loaded.has(position) ? (
            <Image
              src={photo.src}
              alt={photo.alt}
              fill
              sizes={sizes}
              className="object-contain"
              preload={preloadFirst && position === 0}
              fetchPriority={preloadFirst && position === 0 ? "high" : undefined}
            />
          ) : null}
          {hydrated ? overlay?.(position) : null}
        </div>
      ))}
    </div>
  );
}
