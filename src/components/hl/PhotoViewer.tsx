"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type MouseEvent, type Ref } from "react";
import { catalogWords } from "@/content/catalog";
import type { ItemPhoto } from "./catalog-data";
import { PhotoStrip, usePhotoStrip } from "./PhotoStrip";

export type PhotoViewerHandle = {
  /** Opens the closer look on a photo. Called from the press on that photo, so the dialog is open before anything measures it. */
  open: (position: number) => void;
};

const BUTTON =
  "inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill border border-ink bg-white px-4 font-ui text-label font-medium aria-disabled:cursor-default aria-disabled:opacity-50";

/** Whether a press at (x, y) landed on the photo itself, which `object-contain` draws smaller than the image element's box. */
function onPhoto(image: HTMLImageElement, x: number, y: number): boolean {
  const { naturalWidth: width, naturalHeight: height } = image;
  if (!width || !height) return true;
  const box = image.getBoundingClientRect();
  const scale = Math.min(box.width / width, box.height / height);
  const shownWidth = width * scale;
  const shownHeight = height * scale;
  const left = box.left + (box.width - shownWidth) / 2;
  const top = box.top + (box.height - shownHeight) / 2;
  return x >= left && x <= left + shownWidth && y >= top && y <= top + shownHeight;
}

/**
 * The closer look at a piece's photos: a native modal `<dialog>` (the page behind is inert, focus stays inside, Escape closes)
 * holding the same swipe strip as the page, the photo as large as the screen allows, Previous and Next, and a Close button.
 * A press outside the photo and the controls closes it. `onClose` gets the photo last seen so the page can show it.
 */
export function PhotoViewer({ photos, name, onClose, ref }: { photos: readonly ItemPhoto[]; name: string; onClose: (last: number) => void; ref: Ref<PhotoViewerHandle> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const last = useRef(0);
  const [start, setStart] = useState<number | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      open(position) {
        last.current = position;
        setStart(position);
        if (dialog.current && !dialog.current.open) dialog.current.showModal();
      },
    }),
    [],
  );

  const seen = useCallback((position: number) => {
    last.current = position;
  }, []);

  const closeIfOutside = (event: MouseEvent<HTMLDialogElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button")) return;
    if (target instanceof HTMLImageElement && onPhoto(target, event.clientX, event.clientY)) return;
    dialog.current?.close();
  };

  return (
    <dialog
      ref={dialog}
      aria-label={catalogWords.largeView(name)}
      onClick={closeIfOutside}
      onClose={() => {
        setStart(null);
        onClose(last.current);
      }}
      className="m-0 h-dvh max-h-none w-dvw max-w-none overflow-hidden border-0 bg-silver p-0 text-ink open:flex"
    >
      {start === null ? null : <ViewerBody photos={photos} start={start} seen={seen} close={() => dialog.current?.close()} />}
    </dialog>
  );
}

function ViewerBody({ photos, start, seen, close }: { photos: readonly ItemPhoto[]; start: number; seen: (position: number) => void; close: () => void }) {
  const strip = usePhotoStrip(start);
  const { index, select } = strip;
  const lastIndex = photos.length - 1;

  useEffect(() => seen(index), [index, seen]);

  const step = (by: number) => {
    const next = index + by;
    if (next >= 0 && next <= lastIndex) select(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    // The strip would also scroll by itself on an arrow key; the keys step one photo instead.
    event.preventDefault();
    step(event.key === "ArrowLeft" ? -1 : 1);
  };

  return (
    // The key handler only repeats what the Previous and Next buttons do.
    <div onKeyDown={onKeyDown} className="flex h-full w-full flex-col">
      <div className="flex justify-end p-3">
        <button type="button" onClick={close} className={BUTTON}>
          {catalogWords.closeLarge}
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <PhotoStrip photos={photos} strip={strip} sizes="100vw" className="h-full w-full" focusable={{ label: catalogWords.photos }} />
      </div>
      <div className="flex items-center justify-between gap-3 p-3">
        <button type="button" aria-disabled={index === 0} onClick={() => step(-1)} className={BUTTON}>
          {catalogWords.previousPhoto}
        </button>
        <p aria-live="polite" className="font-ui text-label font-medium">
          {catalogWords.photoCount(index + 1, photos.length)}
        </p>
        <button type="button" aria-disabled={index === lastIndex} onClick={() => step(1)} className={BUTTON}>
          {catalogWords.nextPhoto}
        </button>
      </div>
    </div>
  );
}
