# Ad tracking and lead source

This page explains how a site counts visitors from ads, which ad brought each lead, and how to test it.

## What it does

The site can load three tracking tags: Google Analytics 4 (GA4), Google Ads and the Meta Pixel. A tag is a small script that
reports a visit or an action (such as a form send) to the ad company. The owner sets the tag IDs in `site.config.ts`
(`tracking`). Tags load only on the live site, on its own domain, and only when the visitor's browser does not send
Global Privacy Control (GPC, a browser setting that asks sites not to track). With no IDs set, no tag loads and the site
is the same as before.

The site also keeps a record of where each visitor came from. It is a small cookie, named `hl_src`, that the site's own
Worker sets. It remembers the first visit that came from an ad or another site, and the latest visit from an ad, for 90 days. When a visitor
sends the contact form or any form the owner made, the record goes to the Google Sheet, the notification email and the
Pipeline app. This works even when the tags are off, and even on preview links.

**Not built in this run:** server-side conversions (sending sales back to Google Ads or Meta from the server), a consent
banner, a reporting page on the site, Google Tag Manager, and the Microsoft (Bing) UET tag. Page copy does not change.

## Set up one site (Grant)

Do these in order. Keep the IDs out of chat and out of email. They go only into `site.config.ts`. The Google and Meta menu
names below were right in November 2026; both rename menus often, so look for the nearest match.

1. **Create the GA4 property and web stream.** In Google Analytics, create a property for the site. Add a web stream
   for the site's address. The stream shows a measurement ID that looks like `G-XXXXXXXXXX`. Copy it.
2. **Adjust GA4 enhanced measurement.** Enhanced measurement is GA4's list of automatic events. Under Page views
   (advanced), switch off **"Page changes based on browser history events"**. Also switch off **"Form interactions"**.
   Why: the site already sends a page view on every page change and a form start on the first focus of a form (design
   ruling 7). With these switched on, each one is counted twice.
3. **Create the Google Ads conversion actions.** In Google Ads, create two conversion actions: **Lead** and
   **Purchase**. Choose the Google tag as the source. Copy the Google Ads ID (`AW-XXXXXXXXX`) and the two conversion
   labels. A label is the part after the slash in the `send_to` value of each action, for example the `XXXXXXXXXXXX`
   in `AW-XXXXXXXXX/XXXXXXXXXXXX`.
4. **Turn on Google Ads auto-tagging.** Auto-tagging adds a `gclid` value to each ad click so the visit can be matched
   to the ad. Turn it on in the Google Ads account settings. Leave **enhanced conversions** and "user-provided data
   collection" off, in Google Ads and in GA4: they read names and emails from the page, and the site promises that no
   personal data goes to Google. Leave **Google signals** off in GA4 too (the site turns it off and its security list does
   not allow it, design ruling 9).
5. **Link Google Ads to GA4.** In GA4, open Admin, then Product links, then Google Ads links. Link the Google Ads
   account. This lets GA4 show ad campaigns and lets Google Ads use GA4 data.
6. **Mark the two key events.** In GA4, mark `generate_lead` and `purchase` as key events (GA4's word for a
   conversion). The site sends a lead as `generate_lead`, not `lead`, because `generate_lead` is the name GA4's lead
   reports expect (design ruling 6). Only `generate_lead` and `purchase` need to be key events.
7. **Create the Meta Pixel.** In Meta Events Manager, create a Meta Pixel for the site. Copy its ID: 15 to 17 digits.
   In the Pixel's settings, switch off **Automatic advanced matching** (it reads emails and phone numbers from forms) and
   leave "Track events automatically without code" off. The site already turns off the Pixel's automatic configuration in
   code, so Meta gets only the events in the table below.
8. **Put the IDs in the site settings.** Open `site.config.ts` and fill in the `tracking` group: `ga4MeasurementId`,
   `googleAds.id`, `googleAds.leadLabel`, `googleAds.purchaseLabel` and `metaPixelId`. Leave any product you do not use
   as `null`.
9. **Update the security list and check the settings.** Run `npm run sync:config`. It adds only the security-policy
   origins that the IDs you set need (see the origins table in the README). Then run `npm run check:config`. It fails on a
   bad format, a label with no Google Ads ID, or a `[[placeholder]]`.
10. **Open a pull request.** Commit the change on a branch and open a pull request. Merge it after the checks pass. The
    merge deploys to the live site. The tags start to load on the live domain only after that deploy.
11. **Test each tag.** Follow "How to test each tag" below. Tick the rows in `docs/LAUNCH-CHECKLIST.md`.

## Events

The site sends these events. "Reserved" means the event exists in the code but no page uses it yet. Those are for later
features (bookings and gift cards).

| Event | When it fires | GA4 name | Google Ads | Meta Pixel |
|---|---|---|---|---|
| Page view | Each time a visitor opens a page, and each time the page changes without a reload | `page_view` | none: Google Ads gets conversions only (design ruling 17) | `PageView` |
| Form start | The first time a visitor clicks into a form (the contact form or a form the owner made) | `form_start` | none | none |
| Lead | A form is sent and the server confirms it was saved (the quote form included, with form ID `quote`) | `generate_lead` | Counts as a conversion (the Lead label) | `Lead` |
| Click call | A visitor clicks a phone number link | `click_call` | none | `Contact` |
| Click email | A visitor clicks an email address link | `click_email` | none | `Contact` |
| View item | A visitor opens one catalog piece's page. Once per view | `view_item` | none | `ViewContent` |
| Quote start | A visitor presses "Request this quote" in the catalog's quote builder | `quote_start` | none | none |
| Begin checkout | Reserved: a visitor starts paying | `begin_checkout` | none | `InitiateCheckout` |
| Purchase | Reserved: a sale is complete | `purchase` | Counts as a conversion (the Purchase label) | `Purchase` |

A catalog piece's page sends "View item" once per view; "Request this quote" in the quote builder sends "Quote start";
a quote request that reaches the owner sends "Lead" with `form_id` `quote`.

Notes:

- No event carries a name, an email address, a phone number, an answer or a link. Only the form's ID, an item ID, and
  a price and currency (for purchases) can go with an event.
- Catalog events send ids and names only. "View item" sends the piece's slug (`item_id`) and its name (`item_name`).
  "Quote start" sends the slug only. "Lead" and "Form start" send the form's ID, so the quote form sends `quote`. No
  event sends a price, an estimate, an option choice, a guest count or a quote answer.
- Meta gets only standard events. Form starts and quote starts stay in GA4.
- The lead and purchase conversions are the ones Google Ads and Meta count as results.
- Google Ads gets no page views, so it builds no remarketing lists (lists of past visitors to show ads to again). A page
  view sent to Google Ads sets third-party cookies on every page, which costs the site its best-practices score. To
  turn remarketing on later, see design ruling 17.
- The page address every GA4 event gets keeps only the campaign values (`utm_*`, `gad_*`) and click IDs, so anything
  else in a link never reaches GA4. The Google Ads and Meta scripts read the page address themselves, so a link that
  carries an email address would still reach them: never put personal data in a link to the site.
- Blocks report with `track()` from `src/tracking/track.ts`, from an event handler or an effect, never during render.
  The tag loader is set up before any block's effects run.

## Funnel report in GA4

A funnel report shows how many visitors reach each step, and where they stop. This one shows the path from an ad to a lead.

1. In GA4, open **Explore**, then start a **Funnel exploration**.
2. Add three steps, in this order: `page_view` (the landing page), then `form_start`, then `generate_lead`.
3. Break the report down by **Session campaign**, so each campaign has its own row.
4. Save it as **Ad funnel**.

## How to test each tag

Tags never load on preview links or on a local `npm run dev` server. Test on the live site's own address after the
deploy. Before that, the local check below shows the whole path with fake IDs.

**GA4.** Open GA4 **Realtime** and open the live site in another tab. Your visit should show within a minute or two.
For each event, use **DebugView**. Connect the site with **Google Tag Assistant** (a browser extension that checks Google
tags). It turns on debug mode so each event shows in DebugView under its name.

**Google Ads.** Send a test lead from the live site. Then open the conversion action (Lead or Purchase) in Google Ads.
Its status should show that conversions are being recorded. It can take up to a day to show. Tag Assistant also shows the
Google Ads tag on the page.

**Meta Pixel.** Open Meta Events Manager, then **Test events**. Enter the live site's address. Open the site with the
Meta Pixel Helper (a browser extension that shows Meta pixels) to see each event. Test a page view, a click on a phone
link and a sent form.

**Global Privacy Control (GPC).** Use a browser with GPC turned on (a browser or extension setting that sends the
signal). Open the live site, then open the Network tab in the browser's developer tools. No request to `googletagmanager.com`,
`googleadservices.com`, `connect.facebook.net` or `facebook.com` should appear. The source record still works with GPC
on (design ruling 5).

**Source (the lead record).** This test uses a preview link, so it also checks the Sheet and the email:

1. Open a preview link with these values added to the end:
   `?utm_source=test&utm_medium=test&utm_campaign=check&gclid=test123`
2. Close the tab.
3. Open the preview again without any values after the address. This is a return visit.
4. Send the contact form on the preview.
5. In the Google Sheet, open the **Preview** tab. The newest row should show these five new cells filled in:
   Came from: `test / test`. Campaign: `check`. Click ID: `gclid: test123`. First seen: today's date. Days to note: `0`.
6. In the notification email, check the line `Came from: test / test, campaign check, first visit <date> (same day as this note)`.

## Test the tags locally

`npm run test:tracking` runs the tags in a browser against a local fixture build, with every request to Google, Meta
and Cloudflare answered inside the test, so nothing leaves the machine:

1. `TRACKING_FIXTURE=1 npm run build` (fake IDs, see "Settings and files").
2. `npm run test:tracking`. It checks that the tags load after the page, the security list allows them, page_view fires
   on every page change, phone and email clicks fire, the contact form and a form section fire form_start and lead, no
   personal data reaches an event, GPC loads nothing, and the capture script posts only for a tagged or referred visit.
3. To check a page an owner made by chat, make one with the editor's operations (`applyOperations` in
   `worker/editor/operations.ts`, with `add_form` and `add_page`), run `npm run sync:config`, build as in step 1, then
   run `TRACKING_FORM_PAGE=/<page> TRACKING_FORM_ID=<form id> npm run test:tracking`. Delete the two files afterwards.
4. Run `npm run build` again (without the variable) before anything else, so `out/` is a normal build.

Opened in an ordinary browser, a fixture build does request gtag.js and the Meta Pixel with the fake IDs. That sends no
personal data, but use the test above rather than browsing it.

## Campaign names

Use the same names in Google Ads, Meta and any other ad tool. Lowercase, with hyphens for spaces.

| Setting | What to put | Example |
|---|---|---|
| `utm_source` | Where the ad runs | `google`, `facebook`, `instagram`, `bing` |
| `utm_medium` | The kind of ad | `cpc` (paid search), `paid_social` |
| `utm_campaign` | The campaign: year, month, offer, area | `2026-12-spring-offer-area` |
| `utm_content` | The ad version | `variant-a` |
| `utm_term` | The search keyword (Google Ads only) | `{keyword}` |

Where to put them:

- **Google Ads:** in the **final URL suffix** setting, for example
  `utm_source=google&utm_medium=cpc&utm_campaign=2026-12-spring-offer-area&utm_term={keyword}`.
- **Meta:** in the **URL parameters** field of the ad, for example
  `utm_source=facebook&utm_medium=paid_social&utm_campaign=2026-12-spring-offer-area&utm_content=variant-a`.

## Weekly report

Each number comes from one place. Use the same date range in every place.

| Number | Where it comes from |
|---|---|
| Spend, impressions, clicks, cost per click | The Google Ads and Meta ad accounts |
| Sessions by campaign, engagement | GA4, the report by session campaign |
| Funnel (landing, form start, lead) | GA4, the **Ad funnel** report |
| Leads | The Google Sheet: count the rows for the period in the Submissions tab (contact form) and the Forms tabs (other forms) |
| Which ad each lead came from | The Sheet, **Came from** and **Campaign** columns |
| Days to note | The Sheet, **Days to note** column |
| Cost per lead | Spend for one campaign (ad account) divided by the leads for that campaign (Sheet) |

The Sheet is the count of real leads. GA4 and the ad accounts can count a little differently, because some browsers block
cookies and tags. Use the Sheet for the lead count and the cost per lead.

## How source capture works

**The cookie.** The cookie is named `hl_src`. Only the site's Worker sets it, in a response to `POST /api/visit`. It is
marked HttpOnly, so page scripts cannot read it. It lasts 90 days. It holds no names or emails, only the source details
below.

**What is recorded.** Two visits are kept:

- **First touch:** the first visit that came from an ad or a link. Its date is "First seen".
- **Last tagged touch:** the latest visit with an ad tag (a `utm_*` value or a click ID such as `gclid`). The report uses
  this one for "Came from" and "Campaign", the same way GA4 and Google Ads do.

A first visit with no tag, such as a visitor who types the address, is not recorded. So "First seen" and "Days to
note" start at the first tagged visit. Later untagged visits do not change the record. The first touch is kept for 90 days, then the oldest
visit still kept takes its place.

**The five Sheet cells.** Each row gets five new cells at the end. They are stored as text, like every cell the site
writes (that is what keeps a formula out), so to average "Days to note" convert it first, for example
`=AVERAGE(ARRAYFORMULA(VALUE(P2:P)))`.

| Column | Meaning |
|---|---|
| Came from | The source of the attributed visit: `utm_source / utm_medium`. With no `utm_*` values, it shows `Google Ads` (for `gclid`, `gbraid` or `wbraid`), `Facebook or Instagram` (for `fbclid`), `Microsoft Ads` (for `msclkid`), `Referral: <site>` (another website sent them), or `Direct`. With no cookie at all, `Not known`. |
| Campaign | The `utm_campaign` value of that visit |
| Click ID | The first click ID found, shown as `gclid: <value>` |
| First seen (UTC) | The date of the first visit, in UTC time |
| Days to note | Whole days from the first visit to the form send |

The Sheet needs these five headers in the first row of each tab, after the existing headers. On the contact tabs
(Submissions and Preview) that is columns L to P. On the form tabs (Forms and Forms preview) that is columns G to K.
Rows still save without them, but the columns have no names until the headers are added. See the launch checklist.
Before this reaches a Sheet in use, check that those columns are empty: if the owner added columns of their own there
(a "Status" or "Follow-up" column), move them to the right first, or the new cells land under their headers.
On the contact tabs, do not confuse **Came from** (column L, measured by the site) with **Source** (column J, the
visitor's own answer to "How did you hear about me?").

**The email.** The notification email has one new line, for example:
`Came from: google / cpc, campaign 2026-12-spring-offer-area, first visit 2026-11-20 (7 days before this note)`.
When there is no cookie, the line reads `Came from: not known`.

**The Pipeline app.** When the owner's Pipeline app is the destination, the post gains two fields. `source` is a short
summary, at most 60 characters. `attribution` holds the first and last touch with their cleaned values and times, and the
number of days to note. Today the app's `/intake` stores `source` and ignores the rest.

**Limits.**

- Safari deletes script-written cookies after 7 days without user interaction. This cookie is set by the server, so it
  should keep its 90 days in Safari (design ruling 2). Browsers that block cookies, or a visitor who clears them, show `Not known`.
- The cookie holds the first and last touch only. Long values are cut down. Values that are not valid are dropped. The
  submission still goes through in every case.
- Remarketing and conversions depend on the tags. GPC turns the tags off but not the source record.

## Privacy page wording (suggestion)

The privacy page copy is not changed by this run. Every site sets the source cookie from now on, tags or not, so every
privacy page should mention it. With no tags, adapt this sentence:

> The site sets its own cookie that remembers which ad or website brought you here, for 90 days. If you send me a
> message, I keep that with your message. It is not shared with anyone else.

Once tracking is on, adapt this paragraph instead:

> This site uses analytics and advertising measurement tools from Google and Meta. They count visits and show which
> ads bring visitors. The site also sets its own cookie that remembers which ad or website brought you here, for 90
> days. If you send me a message, I keep that with your message. If your browser sends the Global Privacy Control
> signal, the Google and Meta tools do not load.

## Settings and files

| What | Where |
|---|---|
| Tag IDs (the owner's values) | `tracking` in `site.config.ts`. Owner-only. No chat tool can change it. |
| ID formats, CSP origins per product, build decision, fixture IDs | `src/tracking/config.ts` |
| Event names and the mapping to each tag | `src/tracking/events.ts` |
| The `track()` call that blocks use | `src/tracking/track.ts` |
| The inline capture script (runs in the page head) | `src/tracking/capture-script.ts` |
| The tag loader (renders nothing) | `src/components/tracking/TrackingTags.tsx`, placed by `src/tracking/tags-slot-on.tsx`; `next.config.ts` swaps it in for the empty `src/tracking/tags-slot.tsx` only when the build has tags |
| Form start and lead events | `src/components/hl/ContactForm.tsx`, `src/components/hl/FormView.tsx` |
| Cookie setting endpoint (`POST /api/visit`) | `worker/visit.ts` |
| The one place that reads and cleans the cookie | `worker/attribution.ts` |
| Source cells, email line and Pipeline fields | `worker/contact.ts`, `worker/forms.ts`, `worker/messages.ts`, `worker/pipeline.ts`, `worker/sheets.ts` |
| Sheet header notes | `docs/apps-script/contact-sheet.gs` |
| Security list (CSP) | `public/_headers`, generated by `npm run sync:config` |

**Local fixture builds.** `TRACKING_FIXTURE=1 npm run build` builds the site with fake IDs (`G-TEST000000`, `AW-000000000`,
`000000000000000`) so tests can see tags load. It skips the host check and writes the matching security list into
`out/_headers`. It is for local test builds only. A production build with this variable set fails on purpose, so fake
IDs cannot reach the live site. Do not set it in Workers Builds.

## Sheet columns and the 20-column limit

The Apps Script writer accepts up to 20 columns, so existing Sheets keep saving. The contact tabs grow from 11 to 16
columns (A to P). The form tabs grow from 6 to 11 columns (A to K). The service-account writer reads `A:T`.
