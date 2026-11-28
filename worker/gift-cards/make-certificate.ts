import brand from "../../src/content/brand.json" with { type: "json" };
import type { ContactEnv } from "../env.ts";
import { loadCertificateAssets, type CertificateAssetDeps } from "./certificate-assets.ts";
import { certificatePdf } from "./certificate.ts";
import type { MakeCertificate } from "./deps.ts";

/** The logo is the brand's uploaded image, or null (the certificate then sets the business name in type). */
const LOGO_SRC: string | null = brand.logo === null ? null : (brand.logo as { src: string }).src;

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Reads the certificate's fonts and logo from the site's own static files; the Images binding turns the logo into PNG. */
export function certificateDeps(env: ContactEnv, requestUrl: string): CertificateAssetDeps {
  const origin = new URL(requestUrl).origin;
  const images = env.IMAGES;
  return {
    fetchAsset: (path) => {
      if (!env.ASSETS) return Promise.resolve(new Response(null, { status: 404 }));
      return env.ASSETS.fetch(new Request(new URL(path, origin)));
    },
    ...(images
      ? {
          toPng: async (webp: ReadableStream) => {
            const result = await images.input(webp as ReadableStream<Uint8Array>).output({ format: "image/png" });
            return readAll(result.image());
          },
        }
      : {}),
  };
}

/** The production certificate maker (design R10): the site's fonts and logo, then the one-page PDF. */
export const makeCertificate: MakeCertificate = async (input, env, requestUrl) => {
  const assets = await loadCertificateAssets(certificateDeps(env, requestUrl), LOGO_SRC);
  return certificatePdf(input, assets);
};
