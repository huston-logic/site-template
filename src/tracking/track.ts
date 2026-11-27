// What blocks call to report an event. With no tags on the page (no IDs, a preview, or Global Privacy Control) it does
// nothing. No queue: blocks report only after hydration, when TrackingTags has already set window.hlTrack, and a queue
// would make every page's shared chunk bigger (docs/superpowers/specs/2026-11-27-ad-tracking-design.md, ruling 4).
import type { EventName, EventParams } from "./events.ts";

declare global {
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
  interface Window {
    hlTrack?: (name: string, params?: unknown) => void;
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    fbq?: Fbq;
    _fbq?: Fbq;
  }
}

export interface Fbq {
  (...args: unknown[]): void;
  callMethod?: (...args: unknown[]) => void;
  queue: unknown[];
  push: Fbq;
  loaded: boolean;
  version: string;
}

export function track<N extends EventName>(name: N, params?: EventParams[N]): void {
  if (typeof window === "undefined") return;
  // A failing third-party script must never stop a form's success step.
  try {
    window.hlTrack?.(name, params);
  } catch {
    // Reporting is best effort.
  }
}
