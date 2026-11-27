import type { Metadata, Viewport } from "next";
import { siteConfig } from "@/content/site";
import { inter, newsreader, outfit } from "@/lib/fonts";
import { OG_IMAGE_PATH, ogImages, siteName } from "@/lib/metadata";
import { getBrand } from "@/lib/settings";
import { CAPTURE_SCRIPT } from "@/tracking/capture-script";
import { TagsSlot } from "@/tracking/tags-slot";
import "./palette.css";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: "[[Default site title]]",
    template: `%s | ${siteConfig.name}`,
  },
  applicationName: siteConfig.name,
  authors: [{ name: siteConfig.founder }],
  openGraph: {
    type: "website",
    siteName: siteName(),
    locale: "en_US",
    images: ogImages(),
  },
  twitter: { card: "summary_large_image", images: [OG_IMAGE_PATH] },
};

export const viewport: Viewport = {
  themeColor: getBrand().colors.silver,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${outfit.variable} ${inter.variable} ${newsreader.variable}`}>
      <head>
        <script>{"document.documentElement.classList.add('js')"}</script>
        <script>{CAPTURE_SCRIPT}</script>
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-ink px-4 py-3 font-semibold text-white focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to main content
        </a>
        {/* The header, main and footer come from app/(site)/layout.tsx (SiteChrome). */}
        {/* Before the page: its effects then run before any block's, so a block may report from a mount effect. */}
        <TagsSlot />
        {children}
      </body>
    </html>
  );
}
