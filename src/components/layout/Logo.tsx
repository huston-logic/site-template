import Image from "next/image";
import Link from "next/link";
import { Text } from "@/components/ui/Text";
import { logoImage } from "@/lib/chrome-view";
import { getBrand, getBusiness } from "@/lib/settings";

const sizes = {
  header: "text-[20px] md:text-[22px]",
  footer: "text-[20px]",
} as const;

/** The logo image from brand.json when there is one, otherwise the business name as text, linking home. */
export function Logo({ size = "header" }: { size?: keyof typeof sizes }) {
  const name = getBusiness().name;
  const image = logoImage(getBrand().logo, size);
  return (
    <Link
      href="/"
      aria-label={`${name}, home`}
      className={`inline-flex min-h-11 items-center rounded-btn font-ui font-semibold text-ink ${sizes[size]}`}
    >
      {image ? <Image src={image.src} alt={image.alt} width={image.width} height={image.height} unoptimized /> : <Text>{name}</Text>}
    </Link>
  );
}
