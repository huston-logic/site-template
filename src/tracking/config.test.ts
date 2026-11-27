import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, test } from "node:test";
import {
  EMPTY_TRACKING,
  FIXTURE_TRACKING,
  isSiteHost,
  trackingCspOrigins,
  trackingForBuild,
  trackingIds,
  trackingProblems,
  type TrackingSettings,
} from "./config.ts";

const settings = (over: { ga4?: string | null; ads?: Partial<TrackingSettings["googleAds"]>; meta?: string | null } = {}): TrackingSettings => ({
  ga4MeasurementId: over.ga4 ?? null,
  googleAds: { ...EMPTY_TRACKING.googleAds, ...over.ads },
  metaPixelId: over.meta ?? null,
});

const GA4 = "G-ABC123DEF4";
const ADS = "AW-123456789";
const META = "123456789012345";

describe("trackingProblems", () => {
  test("nothing set, or no group, has no problems", () => {
    assert.deepEqual(trackingProblems(EMPTY_TRACKING), []);
    assert.deepEqual(trackingProblems(undefined), []);
    assert.deepEqual(trackingProblems(null), []);
  });

  test("good IDs and labels pass", () => {
    assert.deepEqual(trackingProblems(settings({ ga4: GA4, ads: { id: ADS, leadLabel: "abcDEF_123-x", purchaseLabel: "Zz9Zz9" }, meta: META })), []);
    assert.deepEqual(trackingProblems(settings({ ads: { id: "AW-12345678901" } })), []);
    assert.deepEqual(trackingProblems(settings({ meta: "12345678901234567" })), []);
  });

  test("each bad format is named by its path", () => {
    const cases: Array<[string, TrackingSettings]> = [
      ["tracking.ga4MeasurementId", settings({ ga4: "g-abc123def4" })],
      ["tracking.ga4MeasurementId", settings({ ga4: "G-SHORT" })],
      ["tracking.ga4MeasurementId", settings({ ga4: "UA-123456-1" })],
      ["tracking.googleAds.id", settings({ ads: { id: "AW-12345678" } })],
      ["tracking.googleAds.id", settings({ ads: { id: "AW-123456789012" } })],
      ["tracking.googleAds.id", settings({ ads: { id: "123456789" } })],
      ["tracking.googleAds.leadLabel", settings({ ads: { id: ADS, leadLabel: "short" } })],
      ["tracking.googleAds.leadLabel", settings({ ads: { id: ADS, leadLabel: "has space label" } })],
      ["tracking.googleAds.purchaseLabel", settings({ ads: { id: ADS, purchaseLabel: "x".repeat(41) } })],
      ["tracking.metaPixelId", settings({ meta: "12345678901234" })],
      ["tracking.metaPixelId", settings({ meta: "123456789012345678" })],
      ["tracking.metaPixelId", settings({ meta: "12345678901234a" })],
    ];
    for (const [path, value] of cases) {
      const problems = trackingProblems(value);
      assert.equal(problems.length, 1, JSON.stringify(value));
      assert.ok((problems[0] ?? "").startsWith(`site.config.ts  ${path} must be`), problems[0]);
    }
  });

  test("a conversion label without the Ads id is a problem", () => {
    for (const ads of [{ leadLabel: "LeadLabel1" }, { purchaseLabel: "PurchaseLabel1" }]) {
      const problems = trackingProblems(settings({ ads }));
      assert.equal(problems.length, 1);
      assert.match(problems[0] ?? "", /tracking\.googleAds\.id must be set when a conversion label is set/);
    }
  });

  test("a [[placeholder]] value is refused by format", () => {
    assert.equal(trackingProblems(settings({ ga4: "[[GA4_ID]]" })).length, 1);
    assert.equal(trackingProblems(settings({ ads: { id: "[[ADS_ID]]" } })).length, 1);
    assert.equal(trackingProblems(settings({ meta: "[[PIXEL]]" })).length, 1);
    assert.equal(trackingProblems(settings({ ads: { id: ADS, leadLabel: "[[LEAD_LABEL]]" } })).length, 1);
  });

  test("a non-string value is a problem", () => {
    assert.equal(trackingProblems({ ga4MeasurementId: 12345 as unknown as string }).length, 1);
  });
});

describe("trackingIds", () => {
  test("null when nothing is set or there is no group", () => {
    assert.equal(trackingIds(EMPTY_TRACKING), null);
    assert.equal(trackingIds(undefined), null);
    assert.equal(trackingIds(null), null);
  });

  test("only set values appear, and labels only with the Ads id", () => {
    assert.deepEqual(trackingIds(settings({ ga4: GA4 })), { ga4: GA4 });
    assert.deepEqual(trackingIds(settings({ ads: { id: ADS } })), { ads: { id: ADS } });
    assert.deepEqual(trackingIds(settings({ ads: { id: ADS, leadLabel: "LeadLabel1" } })), { ads: { id: ADS, leadLabel: "LeadLabel1" } });
    assert.deepEqual(trackingIds(settings({ ads: { leadLabel: "LeadLabel1", purchaseLabel: "Purch1" } })), null);
    assert.deepEqual(trackingIds(settings({ meta: META })), { meta: META });
    assert.deepEqual(trackingIds(settings({ ga4: GA4, ads: { id: ADS, purchaseLabel: "Purch123" }, meta: META })), {
      ga4: GA4,
      ads: { id: ADS, purchaseLabel: "Purch123" },
      meta: META,
    });
  });
});

describe("trackingCspOrigins", () => {
  const none = { script: [], img: [], connect: [], frame: [] };

  test("nothing set adds nothing", () => {
    assert.deepEqual(trackingCspOrigins(EMPTY_TRACKING), none);
    assert.deepEqual(trackingCspOrigins(undefined), none);
  });

  test("GA4 alone", () => {
    assert.deepEqual(trackingCspOrigins(settings({ ga4: GA4 })), {
      script: ["https://www.googletagmanager.com"],
      img: ["https://www.googletagmanager.com", "https://*.google-analytics.com"],
      connect: ["https://www.googletagmanager.com", "https://*.google-analytics.com", "https://*.analytics.google.com"],
      frame: [],
    });
  });

  test("Google Ads alone", () => {
    assert.deepEqual(trackingCspOrigins(settings({ ads: { id: ADS } })), {
      script: ["https://www.googletagmanager.com", "https://www.googleadservices.com", "https://www.google.com", "https://googleads.g.doubleclick.net"],
      img: [
        "https://www.googletagmanager.com",
        "https://www.googleadservices.com",
        "https://googleads.g.doubleclick.net",
        "https://pagead2.googlesyndication.com",
        "https://www.google.com",
      ],
      connect: [
        "https://www.googletagmanager.com",
        "https://www.googleadservices.com",
        "https://googleads.g.doubleclick.net",
        "https://pagead2.googlesyndication.com",
        "https://www.google.com",
        "https://ad.doubleclick.net",
      ],
      frame: ["https://www.googletagmanager.com"],
    });
  });

  test("Meta alone", () => {
    assert.deepEqual(trackingCspOrigins(settings({ meta: META })), {
      script: ["https://connect.facebook.net"],
      img: ["https://www.facebook.com"],
      connect: ["https://www.facebook.com", "https://connect.facebook.net"],
      frame: [],
    });
  });

  test("all three, de-duplicated, GA4 then Ads then Meta", () => {
    assert.deepEqual(trackingCspOrigins(settings({ ga4: GA4, ads: { id: ADS }, meta: META })), {
      script: ["https://www.googletagmanager.com", "https://www.googleadservices.com", "https://www.google.com", "https://googleads.g.doubleclick.net", "https://connect.facebook.net"],
      img: [
        "https://www.googletagmanager.com",
        "https://*.google-analytics.com",
        "https://www.googleadservices.com",
        "https://googleads.g.doubleclick.net",
        "https://pagead2.googlesyndication.com",
        "https://www.google.com",
        "https://www.facebook.com",
      ],
      connect: [
        "https://www.googletagmanager.com",
        "https://*.google-analytics.com",
        "https://*.analytics.google.com",
        "https://www.googleadservices.com",
        "https://googleads.g.doubleclick.net",
        "https://pagead2.googlesyndication.com",
        "https://www.google.com",
        "https://ad.doubleclick.net",
        "https://www.facebook.com",
        "https://connect.facebook.net",
      ],
      frame: ["https://www.googletagmanager.com"],
    });
  });
});

describe("trackingForBuild", () => {
  const config = {
    tracking: settings({ ga4: GA4, ads: { id: ADS }, meta: META }),
    domain: { url: "https://www.example.com/", productionBranch: "main" },
  };
  const production = { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main" };

  test("null in dev and on previews, even with IDs set", () => {
    assert.equal(trackingForBuild(config, {}), null);
    assert.equal(trackingForBuild(config, { WORKERS_CI: "1", WORKERS_CI_BRANCH: "change/x" }), null);
    assert.equal(trackingForBuild(config, { GITHUB_SHA: "abc" }), null);
  });

  test("the real IDs and the site host on a production build", () => {
    assert.deepEqual(trackingForBuild(config, production), {
      ids: { ga4: GA4, ads: { id: ADS }, meta: META },
      host: "www.example.com",
    });
  });

  test("null on production when no ID is set", () => {
    assert.equal(trackingForBuild({ ...config, tracking: EMPTY_TRACKING }, production), null);
    assert.equal(trackingForBuild({ domain: config.domain }, production), null);
  });

  test("the fixture IDs with no host check on a non-production build, whatever the config holds", () => {
    const result = trackingForBuild({ ...config, tracking: EMPTY_TRACKING }, { TRACKING_FIXTURE: "1" });
    assert.deepEqual(result, { ids: trackingIds(FIXTURE_TRACKING), host: null });
    assert.throws(() => trackingForBuild(config, { TRACKING_FIXTURE: "1", WORKERS_CI: "1", WORKERS_CI_BRANCH: "feat/x" }), /Workers Builds build/);
  });

  test("the fixture on a production build throws", () => {
    assert.throws(() => trackingForBuild(config, { ...production, TRACKING_FIXTURE: "1" }), /TRACKING_FIXTURE=1 is for local test builds only/);
    assert.throws(() => trackingForBuild(config, { WORKERS_CI: "1", TRACKING_FIXTURE: "1" }), /local test builds only/);
  });

  test("a fixture value other than 1 is ignored", () => {
    assert.equal(trackingForBuild(config, { TRACKING_FIXTURE: "true" }), null);
  });
});

describe("isSiteHost", () => {
  test("the site's host or its www. twin, in any case", () => {
    assert.equal(isSiteHost("example.com", "example.com"), true);
    assert.equal(isSiteHost("www.example.com", "example.com"), true);
    assert.equal(isSiteHost("example.com", "www.example.com"), true);
    assert.equal(isSiteHost("EXAMPLE.com", "example.com"), true);
  });

  test("anything else is not", () => {
    assert.equal(isSiteHost("example.org", "example.com"), false);
    assert.equal(isSiteHost("evil-example.com", "example.com"), false);
    assert.equal(isSiteHost("example.com.evil.net", "example.com"), false);
    assert.equal(isSiteHost("shop.example.com", "example.com"), false);
    assert.equal(isSiteHost("localhost", "example.com"), false);
  });
});

// The build-time swap (next.config.ts) only works while its alias key is exactly the layout's import and points at a
// real file. If a rename breaks either, a production build with IDs would quietly ship no tags.
test("the tag-slot alias in next.config.ts matches the layout's import and an existing file", () => {
  const nextConfig = readFileSync(new URL("../../next.config.ts", import.meta.url), "utf8");
  const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const alias = nextConfig.match(/\{ "(@\/tracking\/[^"]+)": "\.\/([^"]+)" \}/);
  assert.ok(alias, "next.config.ts has the tag-slot alias");
  assert.ok(layout.includes(`import { TagsSlot } from "${alias[1]}";`), "layout.tsx imports the aliased path");
  assert.ok(existsSync(new URL(`../../${alias[2]}`, import.meta.url)), alias[2]);
  assert.ok(existsSync(new URL("./tags-slot.tsx", import.meta.url)));
});
