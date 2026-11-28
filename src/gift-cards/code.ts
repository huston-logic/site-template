// The gift card code (R5): 12 characters from 30 that cannot be confused aloud, shown as XXXX-XXXX-XXXX. Import-free.

/** No 0, O, 1, I, L or U. */
export const GIFT_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 12;
const GROUP = 4;
// The largest multiple of the alphabet size that fits in a byte; a byte at or above it is thrown away so every letter is equally likely.
const LIMIT = 256 - (256 % GIFT_CODE_ALPHABET.length);

export function newGiftCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let chars = "";
  while (chars.length < LENGTH) {
    for (const byte of random(LENGTH * 2)) {
      if (byte >= LIMIT) continue;
      chars += GIFT_CODE_ALPHABET[byte % GIFT_CODE_ALPHABET.length];
      if (chars.length === LENGTH) break;
    }
  }
  return `${chars.slice(0, GROUP)}-${chars.slice(GROUP, GROUP * 2)}-${chars.slice(GROUP * 2)}`;
}

const CODE_RE = new RegExp(`^[${GIFT_CODE_ALPHABET}]{${GROUP}}-[${GIFT_CODE_ALPHABET}]{${GROUP}}-[${GIFT_CODE_ALPHABET}]{${GROUP}}$`);

export const isGiftCode = (text: unknown): boolean => typeof text === "string" && CODE_RE.test(text);
