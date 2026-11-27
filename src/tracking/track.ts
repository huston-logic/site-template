// What blocks call to report an event. With no tags on the page it only queues (at most 50) and sends nothing.
import type { EventName, EventParams } from "./events.ts";

declare global {
  interface Navigator {
    globalPrivacyControl?: boolean;
  }
  interface Window {
    hlTrack?: (name: string, params?: unknown) => void;
    hlq?: [string, unknown][];
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

const QUEUE_LIMIT = 50;

export function track<N extends EventName>(name: N, params?: EventParams[N]): void {
  if (typeof window === "undefined") return;
  if (typeof window.hlTrack === "function") {
    window.hlTrack(name, params);
    return;
  }
  const queue = (window.hlq ??= []);
  queue.push([name, params]);
  if (queue.length > QUEUE_LIMIT) queue.splice(0, queue.length - QUEUE_LIMIT);
}
