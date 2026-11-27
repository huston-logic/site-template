import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { siteConfig } from "../site.config.ts";
import { FIXTURE_TRACKING } from "../src/tracking/config.ts";
import { headersText } from "./headers-text.mjs";

const NONE = { ga4MeasurementId: null, googleAds: { id: null, leadLabel: null, purchaseLabel: null }, metaPixelId: null };
const withTracking = (tracking) => ({ ...siteConfig, tracking });
const directive = (text, name) => text.split("\n").find((line) => line.includes("Content-Security-Policy: default-src")).split("; ").find((part) => part.startsWith(`${name} `));
const GTM = "https://www.googletagmanager.com";

describe("headersText", () => {
  test("with no tracking ID set, the text is exactly the committed public/_headers", () => {
    assert.equal(headersText(siteConfig), readFileSync(new URL("../public/_headers", import.meta.url), "utf8"));
    assert.equal(headersText(withTracking(NONE)), headersText({ ...siteConfig, tracking: undefined }));
  });

  test("with no tracking ID set there is no tracking comment and no Google or Meta origin", () => {
    const text = headersText(withTracking(NONE));
    assert.doesNotMatch(text, /googletagmanager|facebook|google-analytics|doubleclick/);
    assert.equal(directive(text, "img-src"), "img-src 'self' data:");
  });

  test("GA4 alone adds its origins to script, img and connect, and nothing to frame", () => {
    const base = headersText(withTracking(NONE));
    const text = headersText(withTracking({ ...NONE, ga4MeasurementId: "G-TEST000000" }));
    assert.equal(directive(text, "script-src"), `${directive(base, "script-src")} ${GTM}`);
    assert.equal(directive(text, "img-src"), `img-src 'self' data: ${GTM} https://*.google-analytics.com`);
    assert.equal(directive(text, "connect-src"), `${directive(base, "connect-src")} ${GTM} https://*.google-analytics.com https://*.analytics.google.com`);
    assert.equal(directive(text, "frame-src"), directive(base, "frame-src"));
    assert.match(text, /^# https:\/\/www\.googletagmanager\.com, .*: Google Analytics 4 \(tracking\.ga4MeasurementId\)\.$/m);
    assert.doesNotMatch(text, /Google Ads|Meta Pixel/);
  });

  test("Google Ads alone adds its origins including the Tag Manager frame", () => {
    const base = headersText(withTracking(NONE));
    const text = headersText(withTracking({ ...NONE, googleAds: { id: "AW-000000000", leadLabel: null, purchaseLabel: null } }));
    assert.equal(directive(text, "script-src"), `${directive(base, "script-src")} ${GTM} https://www.googleadservices.com https://www.google.com`);
    assert.equal(
      directive(text, "img-src"),
      `img-src 'self' data: ${GTM} https://www.googleadservices.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://www.google.com`,
    );
    assert.equal(directive(text, "frame-src"), `${directive(base, "frame-src")} ${GTM}`);
    assert.match(directive(text, "connect-src"), / https:\/\/ad\.doubleclick\.net$/);
    assert.match(text, /^# .*: Google Ads \(tracking\.googleAds\)\.$/m);
  });

  test("Meta alone adds its two hosts", () => {
    const base = headersText(withTracking(NONE));
    const text = headersText(withTracking({ ...NONE, metaPixelId: "000000000000000" }));
    assert.equal(directive(text, "script-src"), `${directive(base, "script-src")} https://connect.facebook.net`);
    assert.equal(directive(text, "img-src"), "img-src 'self' data: https://www.facebook.com");
    assert.equal(directive(text, "connect-src"), `${directive(base, "connect-src")} https://www.facebook.com https://connect.facebook.net`);
    assert.equal(directive(text, "frame-src"), directive(base, "frame-src"));
    assert.match(text, /^# https:\/\/connect\.facebook\.net, https:\/\/www\.facebook\.com \(script-src, img-src, connect-src\): Meta Pixel \(tracking\.metaPixelId\)\.$/m);
  });

  test("the fixture IDs give the full CSP with one comment per product, and nothing else changes", () => {
    const base = headersText(withTracking(NONE));
    const text = headersText(withTracking(FIXTURE_TRACKING));
    assert.equal(
      directive(text, "script-src"),
      `${directive(base, "script-src")} ${GTM} https://www.googleadservices.com https://www.google.com https://connect.facebook.net`,
    );
    assert.equal(
      directive(text, "img-src"),
      `img-src 'self' data: ${GTM} https://*.google-analytics.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://www.google.com https://www.facebook.com`,
    );
    assert.equal(
      directive(text, "connect-src"),
      `${directive(base, "connect-src")} ${GTM} https://*.google-analytics.com https://*.analytics.google.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://pagead2.googlesyndication.com https://www.google.com https://ad.doubleclick.net https://www.facebook.com https://connect.facebook.net`,
    );
    assert.equal(directive(text, "frame-src"), `${directive(base, "frame-src")} ${GTM}`);
    assert.equal(text.split("\n").filter((line) => /Google Analytics 4|Google Ads|Meta Pixel/.test(line)).length, 3);
    const stripped = text
      .split("\n")
      .filter((line) => !/Google Analytics 4|Google Ads|Meta Pixel/.test(line) && !line.includes("Content-Security-Policy: default-src"))
      .join("\n");
    const baseStripped = base
      .split("\n")
      .filter((line) => !line.includes("Content-Security-Policy: default-src"))
      .join("\n");
    assert.equal(stripped, baseStripped);
  });
});
