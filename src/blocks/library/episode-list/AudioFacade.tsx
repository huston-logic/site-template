"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { Glow } from "@/components/hl/Glow";
import { fillCopy } from "@/blocks/list-format";
import { playerCopy } from "@/content/players";

type AudioFacadeProps = {
  provider: "spotify" | "apple";
  providerName: string;
  title: string;
  embedUrl: string;
  listenUrl: string;
};

const subscribe = () => () => {};

// The frame's height is the player's exact height, so the swap never moves anything (tokens in hl.css; tested against embeds.ts).
const HEIGHT = { spotify: "h-player-spotify", apple: "h-player-apple" } as const;

/**
 * A podcast episode that loads nothing from its site until it is pressed. Before JavaScript it is a link that opens the
 * episode in a new tab; after, a press swaps the player into the same fixed-height frame and moves focus to it.
 */
export function AudioFacade({ provider, providerName, title, embedUrl, listenUrl }: AudioFacadeProps) {
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLIFrameElement>(null);
  // False in the static HTML (the link opens a new tab), true once a press plays the episode in place.
  const interactive = useSyncExternalStore(subscribe, () => true, () => false);
  const frame = `relative w-full overflow-hidden rounded-card ${HEIGHT[provider]}`;

  useEffect(() => {
    if (playing) player.current?.focus();
  }, [playing]);

  const press = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    setPlaying(true);
  };

  if (playing) {
    return (
      <div className={`block ${frame}`}>
        <iframe
          ref={player}
          src={embedUrl}
          title={title}
          allow="autoplay; encrypted-media"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          className="size-full"
        />
      </div>
    );
  }
  return (
    <a
      href={listenUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={press}
      aria-label={fillCopy(interactive ? playerCopy.playLabel : playerCopy.playLabelNewTab, { title, provider: providerName })}
      className={`group flex items-center gap-5 bg-ink px-6 ${frame}`}
    >
      <Glow variant="green" className="hl-glow-hero opacity-30" />
      <span
        aria-hidden="true"
        className="relative grid size-16 shrink-0 place-items-center rounded-pill bg-silver text-ink shadow-chip transition-transform group-hover:scale-110 group-focus-visible:scale-110"
      >
        <svg viewBox="0 0 24 24" className="size-6 translate-x-0.5" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
      <span aria-hidden="true" className="relative font-ui text-item font-semibold text-silver">
        {providerName}
      </span>
    </a>
  );
}
