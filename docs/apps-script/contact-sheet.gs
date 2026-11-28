/**
 * Contact form -> Google Sheet writer (a Google Apps Script web app).
 *
 * The site's contact Worker (worker/apps-script.ts) POSTs JSON { secret, tab, row } to this script's web-app URL. The
 * script checks the shared secret, accepts only the six configured tab names, and writes the row as plain text.
 * Setup steps: README, "Contact form", "Apps Script setup". Secret names: docs/SECRETS.md.
 *
 * Script Properties (Project Settings > Script properties). No value lives in this file.
 *   SHEET_SECRET    required  The shared secret. Must equal the Worker secret SHEET_WEBHOOK_SECRET.
 *   TAB_PRODUCTION  optional  Tab for live submissions. Default "Submissions" (contact.sheetTabs.production).
 *   TAB_PREVIEW     optional  Tab for branch previews. Default "Preview" (contact.sheetTabs.preview).
 *   TAB_FORMS         optional  Tab for live submissions of every other form. Default "Forms" (contact.sheetTabs.forms).
 *   TAB_FORMS_PREVIEW optional  Tab for branch previews of the other forms. Default "Forms preview" (contact.sheetTabs.formsPreview).
 *   TAB_GIFT_CARDS         optional  Tab for live gift card sales. Default "Gift cards" (contact.sheetTabs.giftCards).
 *   TAB_GIFT_CARDS_PREVIEW optional  Tab for branch previews of gift card sales. Default "Gift cards preview" (contact.sheetTabs.giftCardsPreview).
 *
 * Header row of each tab (row 1), the same order the Worker sends (worker/messages.ts, sheetRow):
 *   Received (UTC) | Need | Topic | Name | Email | Business | Message | Tools | Website | Source | Mode | Came from | Campaign | Click ID | First seen (UTC) | Days to note
 * Header row of the two forms tabs (worker/messages.ts, formSheetRow), one header for every form:
 *   Received (UTC) | Form | Name | Email | Answers | Mode | Came from | Campaign | Click ID | First seen (UTC) | Days to note
 * The last five columns are the lead source (worker/attribution.ts). Rows save with or without their headers.
 * Header row of the two gift card tabs (worker/gift-cards/ledger.ts). The code is in column B, and a row whose code is
 * already in column B of its tab is not added again, so a repeated payment notice never lists a sale twice:
 *   Sold (UTC) | Code | Amount | Buyer | Buyer email | Recipient | Message | Stripe payment | Came from | Campaign | Click ID | First seen (UTC) | Days to note | Used | Balance | Notes
 * Used, Balance and Notes stay empty for the owner to fill in.
 *
 * Deploy as: Web app, Execute as "Me", Who has access "Anyone". The secret is what keeps the URL private.
 * Every failure returns {"ok":false} with no details.
 */

var MAX_COLUMNS = 20;
var MAX_CELL_LENGTH = 6000;

function doPost(e) {
  try {
    var props = PropertiesService.getScriptProperties();
    var expected = props.getProperty("SHEET_SECRET");
    var production = props.getProperty("TAB_PRODUCTION") || "Submissions";
    var preview = props.getProperty("TAB_PREVIEW") || "Preview";
    var forms = props.getProperty("TAB_FORMS") || "Forms";
    var formsPreview = props.getProperty("TAB_FORMS_PREVIEW") || "Forms preview";
    var giftCards = props.getProperty("TAB_GIFT_CARDS") || "Gift cards";
    var giftCardsPreview = props.getProperty("TAB_GIFT_CARDS_PREVIEW") || "Gift cards preview";

    var data = JSON.parse(e.postData.contents);
    // Refuse everything while the secret is unset, so a half-finished setup never accepts rows.
    if (!expected || typeof data.secret !== "string" || !sameText(data.secret, expected)) return reply(false);
    if (data.tab !== production && data.tab !== preview && data.tab !== forms && data.tab !== formsPreview && data.tab !== giftCards && data.tab !== giftCardsPreview) return reply(false);
    var isGiftCardTab = data.tab === giftCards || data.tab === giftCardsPreview;

    var row = data.row;
    if (!Array.isArray(row) || row.length === 0 || row.length > MAX_COLUMNS) return reply(false);
    for (var i = 0; i < row.length; i++) {
      if (typeof row[i] !== "string" || row[i].length > MAX_CELL_LENGTH) return reply(false);
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(data.tab);
      if (!sheet) return reply(false);
      // A gift card is sold once: a row whose code (column B) is already in the tab counts as saved, and is not added again.
      if (isGiftCardTab && row.length > 1 && codeIsListed(sheet, row[1])) return reply(true);
      var target = sheet.getRange(sheet.getLastRow() + 1, 1, 1, row.length);
      // Plain text first ("@"), then the values: nothing the visitor typed can turn into a formula or a date.
      target.setNumberFormat("@");
      target.setValues([row]);
    } finally {
      lock.releaseLock();
    }
    return reply(true);
  } catch (err) {
    return reply(false);
  }
}

/** True when `code` is already in column B of the sheet. Runs under the script lock. */
function codeIsListed(sheet, code) {
  var last = sheet.getLastRow();
  if (last < 1 || !code) return false;
  var values = sheet.getRange(1, 2, last, 1).getValues();
  for (var i = 0; i < values.length; i++) if (String(values[i][0]) === code) return true;
  return false;
}

/** Compares two strings without stopping at the first difference. */
function sameText(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function reply(ok) {
  return ContentService.createTextOutput(JSON.stringify({ ok: ok })).setMimeType(ContentService.MimeType.JSON);
}
