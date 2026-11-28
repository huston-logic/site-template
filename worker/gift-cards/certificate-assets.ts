// Loads what the certificate needs from the site's own static files (env.ASSETS in the Worker): the three fonts that
// scripts/finish-build.mjs copies to /_certificate/ and, if the site has one, the uploaded logo, turned into PNG by `toPng`
// (the Worker backs it with the Images binding). A missing font throws; any logo trouble gives `logo: null`, and the
// layout then sets the business name in type.
import type { CertificateAssets } from "./certificate-types.ts";

export type CertificateAssetDeps = {
  fetchAsset: (path: string) => Promise<Response>;
  toPng?: (webp: ReadableStream) => Promise<Uint8Array | null>;
};

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

async function font(deps: CertificateAssetDeps, path: string): Promise<Uint8Array> {
  const response = await deps.fetchAsset(path);
  if (!response.ok) throw new Error(`Certificate font ${path} is missing (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length < 12) throw new Error(`Certificate font ${path} is empty.`);
  return bytes;
}

async function logo(deps: CertificateAssetDeps, src: string | null): Promise<{ png: Uint8Array } | null> {
  if (src === null || deps.toPng === undefined) return null;
  try {
    const response = await deps.fetchAsset(src);
    if (!response.ok || response.body === null) return null;
    const png = await deps.toPng(response.body);
    if (png === null || png.length < 33 || PNG_SIGNATURE.some((b, i) => png[i] !== b)) return null;
    return { png };
  } catch {
    return null;
  }
}

export async function loadCertificateAssets(deps: CertificateAssetDeps, logoSrc: string | null): Promise<CertificateAssets> {
  const [display, displayBold, accent, logoPng] = await Promise.all([
    font(deps, "/_certificate/display.ttf"),
    font(deps, "/_certificate/display-bold.ttf"),
    font(deps, "/_certificate/accent.ttf"),
    logo(deps, logoSrc),
  ]);
  return { display, displayBold, accent, logo: logoPng };
}
