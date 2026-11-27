"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { isSiteHost, type TrackingBuild } from "@/tracking/config";
import { eventCalls } from "@/tracking/events";
import type { Fbq } from "@/tracking/track";

const GTAG_SRC = "https://www.googletagmanager.com/gtag/js?id=";
const FBEVENTS_SRC = "https://connect.facebook.net/en_US/fbevents.js";

function addScript(src: string) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = src;
  document.head.appendChild(script);
}

function setUpQueues(ids: TrackingBuild["ids"]) {
  window.dataLayer = window.dataLayer ?? [];
  window.gtag =
    window.gtag ??
    function gtag() {
      // gtag.js reads Arguments objects from the data layer; an array of the same values is ignored.
      // eslint-disable-next-line prefer-rest-params
      window.dataLayer?.push(arguments);
    };
  if (ids.meta && !window.fbq) {
    const fbq = function (...args: unknown[]) {
      if (fbq.callMethod) fbq.callMethod(...args);
      else fbq.queue.push(args);
    } as Fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = "2.0";
    fbq.queue = [];
    window.fbq = fbq;
    window._fbq = fbq;
  }
  window.gtag("js", new Date());
  if (ids.ga4) window.gtag("config", ids.ga4, { send_page_view: false, allow_google_signals: false });
  if (ids.ads) window.gtag("config", ids.ads.id, { send_page_view: false });
  if (ids.meta) {
    // Automatic configuration lets the Pixel read buttons and form fields on its own; events come only from events.ts.
    window.fbq?.("set", "autoConfig", false, ids.meta);
    window.fbq?.("init", ids.meta);
  }
}

function onIdle(run: () => void) {
  if (typeof requestIdleCallback === "function") requestIdleCallback(run);
  else setTimeout(run, 1);
}

/** Sets up gtag.js and the Meta Pixel after the page has loaded (docs/superpowers/specs/2026-11-27-ad-tracking-design.md, "Loading"). */
export function TrackingTags({ ids, host }: TrackingBuild) {
  const pathname = usePathname();

  useEffect(() => {
    if (navigator.globalPrivacyControl === true) return;
    if (host !== null && !isSiteHost(location.hostname, host)) return;

    setUpQueues(ids);
    window.hlTrack = (name, params) => {
      for (const call of eventCalls(name, params, ids)) {
        const target = window[call.to];
        if (target) target(...call.args);
      }
    };

    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('a[href^="tel:"]')) window.hlTrack?.("click_call");
      else if (event.target.closest('a[href^="mailto:"]')) window.hlTrack?.("click_email");
    };
    document.addEventListener("click", onClick, true);

    const loadScripts = () =>
      onIdle(() => {
        const gtagId = ids.ga4 ?? ids.ads?.id;
        if (gtagId) addScript(GTAG_SRC + encodeURIComponent(gtagId));
        if (ids.meta) addScript(FBEVENTS_SRC);
      });
    if (document.readyState === "complete") loadScripts();
    else window.addEventListener("load", loadScripts, { once: true });

    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("load", loadScripts);
    };
  }, [ids, host]);

  useEffect(() => {
    // No page_title: on a client-side navigation the title may still be the previous page's; GA4 reads it at send time.
    window.hlTrack?.("page_view", { page_path: pathname });
  }, [pathname]);

  return null;
}
