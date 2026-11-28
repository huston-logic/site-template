import { FONT_FILES } from "./font-files.ts";

export const FONT_ROLES = ["display", "body", "accent"] as const;
export type FontRole = (typeof FONT_ROLES)[number];

export type CuratedFont = {
  id: string;
  /** The Google Fonts family name, exactly as Next's font data spells it. */
  family: string;
  /** What the owner sees in a list. */
  label: string;
  /** Extra variable axes to load (opsz), when the family offers one worth having. */
  axes?: string[];
};

/**
 * The only fonts a site may choose, three roles. Each is one variable Google font with a latin subset, self-hosted by
 * next/font at build time (no third-party font request). The accent role is italic only. The first entry of each role
 * is the template default. src/brand/fonts.test.ts checks every entry against Next's own font data.
 */
export const CURATED_FONTS: Record<FontRole, CuratedFont[]> = {
  display: [
    { id: "outfit", family: "Outfit", label: "Outfit" },
    { id: "manrope", family: "Manrope", label: "Manrope" },
    { id: "sora", family: "Sora", label: "Sora" },
    { id: "dm-sans", family: "DM Sans", label: "DM Sans" },
    { id: "plus-jakarta-sans", family: "Plus Jakarta Sans", label: "Plus Jakarta Sans" },
    { id: "fraunces", family: "Fraunces", label: "Fraunces" },
  ],
  body: [
    { id: "inter", family: "Inter", label: "Inter" },
    { id: "source-sans-3", family: "Source Sans 3", label: "Source Sans 3" },
    { id: "work-sans", family: "Work Sans", label: "Work Sans" },
    { id: "nunito-sans", family: "Nunito Sans", label: "Nunito Sans" },
    { id: "figtree", family: "Figtree", label: "Figtree" },
    { id: "lora", family: "Lora", label: "Lora" },
  ],
  accent: [
    { id: "newsreader", family: "Newsreader", label: "Newsreader", axes: ["opsz"] },
    { id: "fraunces", family: "Fraunces", label: "Fraunces", axes: ["opsz"] },
    { id: "lora", family: "Lora", label: "Lora" },
    { id: "playfair-display", family: "Playfair Display", label: "Playfair Display" },
  ],
};

/**
 * The faces the design draws text in, per role, whatever font fills the role. Measured on every built page at 1440 and
 * 390 pixels wide (2026-11-27). npm run check:design keeps components inside these weights.
 * A role with several weights loads its font's one variable file: Google serves the same file for any weight range,
 * so there is nothing smaller to ask for. A role with one weight loads a file pinned at that weight, which is much
 * smaller (Newsreader italic: 62 KB instead of 144 KB).
 */
export const DESIGN_FACES: Record<FontRole, { style: "normal" | "italic"; weights: number[] }> = {
  display: { style: "normal", weights: [400, 500, 600, 700] },
  body: { style: "normal", weights: [400, 600, 700] },
  accent: { style: "italic", weights: [400] },
};

/** The CSS variable each role keeps whatever the choice, so no component changes when a font does. */
const VARIABLES: Record<FontRole, string> = { display: "--hl-outfit", body: "--font-inter", accent: "--font-newsreader" };
const EXPORTS: Record<FontRole, string> = { display: "outfit", body: "inter", accent: "newsreader" };

const importName = (family: string) => family.replace(/\s+/g, "_");
const pinnedWeight = (role: FontRole) => (DESIGN_FACES[role].weights.length === 1 ? DESIGN_FACES[role].weights[0] : null);

/**
 * True when the role pins one weight and the font keeps an extra axis (opsz). next/font/google can pin a weight only by
 * dropping every other axis, so those files come from scripts/fetch-font-files.mjs and are committed.
 */
export function needsLocalFiles(role: FontRole, font: CuratedFont): boolean {
  return pinnedWeight(role) !== null && (font.axes?.length ?? 0) > 0;
}

/** The key of a font's files in FONT_FILES and the start of their file names. */
export const localFontKey = (role: FontRole, font: CuratedFont) => `${role}-${font.id}`;

type AxisData = { axes?: { tag: string; min: number; max: number }[] };

/**
 * The Google Fonts css2 request for a role's pinned face: the same request next/font/google makes for the font and its
 * axes, except that the weight is the one the design uses. Axes are sorted as Google requires (lowercase tags first).
 */
export function requestFor(role: FontRole, font: CuratedFont, data: AxisData): string {
  const weight = pinnedWeight(role);
  if (weight === null) throw new Error(`The ${role} role uses several weights; it loads the variable file`);
  const axes = (font.axes ?? []).map((tag) => {
    const axis = data.axes?.find((entry) => entry.tag === tag);
    if (!axis) throw new Error(`${font.family} has no ${tag} axis`);
    return [tag, `${axis.min}..${axis.max}`] as const;
  });
  const sorted = [...axes, ["wght", String(weight)] as const].sort(([a], [b]) => {
    const aLower = a.charCodeAt(0) > 96;
    const bLower = b.charCodeAt(0) > 96;
    if (aLower !== bLower) return aLower ? -1 : 1;
    return a > b ? 1 : -1;
  });
  const tags = [...(DESIGN_FACES[role].style === "italic" ? [["ital", "1"] as const] : []), ...sorted];
  return `https://fonts.googleapis.com/css2?family=${font.family.replace(/ /g, "+")}:${tags.map(([tag]) => tag).join(",")}@${tags.map(([, value]) => value).join(",")}&display=swap`;
}

function find(role: FontRole, id: unknown): CuratedFont {
  const font = CURATED_FONTS[role].find((entry) => entry.id === id);
  if (font === undefined) throw new Error(`"${String(id)}" is not an allowed ${role} font. Choose one of: ${CURATED_FONTS[role].map((f) => f.id).join(", ")}.`);
  return font;
}

const axesLine = (font: CuratedFont) => (font.axes?.length ? `\n  axes: ${JSON.stringify(font.axes)},` : "");
const camel = (text: string) => text.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** A next/font/google call: the variable file, or (one design weight, no extra axis) the file pinned at that weight. */
function googleCall(role: FontRole, font: CuratedFont, preload: boolean, comment: string): string {
  const weight = pinnedWeight(role);
  const style = DESIGN_FACES[role].style;
  const lines = [
    `  subsets: ["latin"],`,
    ...(weight !== null ? [`  weight: "${weight}",`] : []),
    ...(style === "italic" ? [`  style: ["italic"],`] : []),
  ].join("\n");
  return `/** ${comment} */
export const ${EXPORTS[role]} = ${importName(font.family)}({
${lines}${weight === null ? axesLine(font) : ""}
  variable: "${VARIABLES[role]}",
  display: "swap",
  preload: ${preload},${role === "display" ? `\n  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],` : ""}
});`;
}

/**
 * next/font/local calls for a font fetched by scripts/fetch-font-files.mjs: one call per subset, all declaring the same
 * family name and Google's unicode-range, so together they are the family Google would serve. The latin call is the
 * export and carries the fallback metrics; it comes last, as in Google's CSS, so it wins where ranges overlap.
 */
function localCalls(role: FontRole, font: CuratedFont, preload: boolean, comment: string): { code: string; binding: string; extras: string[] } {
  const entry = FONT_FILES[localFontKey(role, font)];
  if (!entry) throw new Error(`No font files for ${localFontKey(role, font)}. Run node scripts/fetch-font-files.mjs.`);
  const latin = entry.faces.find((face) => face.subset === "latin");
  if (!latin) throw new Error(`No latin file for ${localFontKey(role, font)}`);
  // Under Turbopack the CSS variable names a local font's family after the JS binding, not the declared family, so
  // the export is the family name itself (CSS matches family names without regard to case). One word only.
  if (!/^[A-Z][A-Za-z]+$/.test(font.family)) throw new Error(`${font.family}: a locally loaded family must be one word`);
  const binding = font.family[0].toLowerCase() + font.family.slice(1);
  const weight = pinnedWeight(role);
  const style = DESIGN_FACES[role].style;
  const call = (face: (typeof entry.faces)[number], name: string, variable: string, isMain: boolean) => `${isMain ? `/** ${comment} */\nexport ` : ""}const ${name} = localFont({
  src: "../brand/font-files/${face.file}",
  weight: "${weight}",
  style: "${style}",
  declarations: [
    { prop: "font-family", value: "${font.family}" },
    { prop: "unicode-range", value: "${face.unicodeRange}" },
  ],
  variable: "${variable}",
  display: "swap",
  preload: ${isMain ? preload : false},
  adjustFontFallback: ${isMain ? `"Times New Roman"` : "false"},
});`;
  const extras: string[] = [];
  const parts: string[] = [];
  for (const face of entry.faces) {
    if (face.subset === "latin") continue;
    const name = camel(`${binding}-${face.subset}`);
    extras.push(name);
    parts.push(call(face, name, `${VARIABLES[role]}-${face.subset}`, false));
  }
  parts.push(call(latin, binding, VARIABLES[role], true));
  return { code: parts.join("\n\n"), binding, extras };
}

/**
 * The text of src/lib/fonts.ts for a choice of fonts. Only curated ids reach it (anything else throws), and every
 * identifier and string in it comes from the tables above and src/brand/font-files.ts, never from the owner's text.
 */
export function fontsModule(choice: Record<FontRole, string>): string {
  const display = find("display", choice.display);
  const body = find("body", choice.body);
  const accent = find("accent", choice.accent);
  const roles: [FontRole, CuratedFont, boolean, string][] = [
    ["display", display, true, "Display and UI: headings, nav, buttons, eyebrows, labels. One variable file (weights 400 to 700 used)."],
    ["body", body, true, "Body text. One variable file (weights 400, 600 and 700 used)."],
    ["accent", accent, false, `The second voice: ${accent.family} italic only, never roman, at the one weight the design uses (400).`],
  ];
  const googleNames = [...new Set(roles.filter(([role, font]) => !needsLocalFiles(role, font)).map(([, font]) => importName(font.family)))].sort();
  const usesLocal = roles.some(([role, font]) => needsLocalFiles(role, font));
  const blocks: string[] = [];
  const variables: string[] = [];
  for (const [role, font, preload, comment] of roles) {
    if (needsLocalFiles(role, font)) {
      const { code, binding, extras } = localCalls(role, font, preload, comment);
      blocks.push(code);
      variables.push(binding, ...extras);
    } else {
      blocks.push(googleCall(role, font, preload, comment));
      variables.push(EXPORTS[role]);
    }
  }
  const imports = [
    ...(googleNames.length ? [`import { ${googleNames.join(", ")} } from "next/font/google";`] : []),
    ...(usesLocal ? [`import localFont from "next/font/local";`] : []),
  ].join("\n");
  return `// Generated from src/content/brand.json by \`npm run sync:config\`; do not edit by hand.
${imports}

// Design v3 fonts (docs/STYLE-GUIDE.md §3), loaded only at the faces the design uses (DESIGN_FACES in src/brand/fonts.ts).
// Each is self-hosted at build time by next/font; no third-party font tags.
// Preloaded: ${display.family} (header and every heading) and ${body.family} (body) render above the fold on every page; ${accent.family} is below the fold, so it is not.

${blocks.join("\n\n")}

/** Every font's CSS variable class, for the <html> element. */
export const fontVariables = [${variables.map((name) => `${name}.variable`).join(", ")}].join(" ");
`;
}
