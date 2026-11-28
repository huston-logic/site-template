// Generated from src/content/brand.json by `npm run sync:config`; do not edit by hand.
import { Inter, Outfit } from "next/font/google";
import localFont from "next/font/local";

// Design v3 fonts (docs/STYLE-GUIDE.md §3), loaded only at the faces the design uses (DESIGN_FACES in src/brand/fonts.ts).
// Each is self-hosted at build time by next/font; no third-party font tags.
// Preloaded: Outfit (header and every heading) and Inter (body) render above the fold on every page; Newsreader is below the fold, so it is not.

/** Display and UI: headings, nav, buttons, eyebrows, labels. One variable file (weights 400 to 700 used). */
export const outfit = Outfit({
  subsets: ["latin"],
  variable: "--hl-outfit",
  display: "swap",
  preload: true,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

/** Body text. One variable file (weights 400, 600 and 700 used). */
export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: true,
});

const newsreaderVietnamese = localFont({
  src: "../brand/font-files/accent-newsreader-vietnamese.woff2",
  weight: "400",
  style: "italic",
  declarations: [
    { prop: "font-family", value: "Newsreader" },
    { prop: "unicode-range", value: "U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB" },
  ],
  variable: "--font-newsreader-vietnamese",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

const newsreaderLatinExt = localFont({
  src: "../brand/font-files/accent-newsreader-latin-ext.woff2",
  weight: "400",
  style: "italic",
  declarations: [
    { prop: "font-family", value: "Newsreader" },
    { prop: "unicode-range", value: "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF" },
  ],
  variable: "--font-newsreader-latin-ext",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
});

/** The second voice: Newsreader italic only, never roman, at the one weight the design uses (400). */
export const newsreader = localFont({
  src: "../brand/font-files/accent-newsreader-latin.woff2",
  weight: "400",
  style: "italic",
  declarations: [
    { prop: "font-family", value: "Newsreader" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
  variable: "--font-newsreader",
  display: "swap",
  preload: false,
  adjustFontFallback: "Times New Roman",
});

/** Every font's CSS variable class, for the <html> element. */
export const fontVariables = [outfit.variable, inter.variable, newsreader.variable, newsreaderVietnamese.variable, newsreaderLatinExt.variable].join(" ");
