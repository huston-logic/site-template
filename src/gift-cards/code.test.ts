import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GIFT_CODE_ALPHABET, isGiftCode, newGiftCode } from "./code.ts";

describe("newGiftCode", () => {
  test("is XXXX-XXXX-XXXX from the alphabet, which has 30 characters and none that sound or look alike", () => {
    assert.equal(GIFT_CODE_ALPHABET, "23456789ABCDEFGHJKMNPQRSTVWXYZ");
    assert.equal(GIFT_CODE_ALPHABET.length, 30);
    for (const bad of "01OILU") assert.ok(!GIFT_CODE_ALPHABET.includes(bad), bad);
    for (let i = 0; i < 200; i++) {
      const code = newGiftCode();
      assert.match(code, /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{4}$/);
      assert.ok(isGiftCode(code));
    }
  });

  test("bytes of 240 and over are thrown away, so no letter is more likely than another", () => {
    // 240 is the largest multiple of 30 in a byte; 240 to 255 would favour the first 16 letters.
    const biased = Uint8Array.from([240, 255, 250, 241, 249]);
    const good = Uint8Array.from({ length: 24 }, (_, i) => i); // 0..23 -> "2".."M"-ish, in order
    let calls = 0;
    const code = newGiftCode(() => (calls++ === 0 ? biased : good));
    assert.equal(calls, 2);
    const letters = code.replaceAll("-", "");
    assert.equal(letters, [...Array(12).keys()].map((i) => GIFT_CODE_ALPHABET[i]).join(""));
  });

  test("byte 239 is used and 240 is not", () => {
    const code = newGiftCode(() => Uint8Array.from([239, 240, ...Array(22).fill(0)]));
    assert.equal(code.replaceAll("-", "")[0], GIFT_CODE_ALPHABET[239 % 30]);
    assert.equal(code.replaceAll("-", "")[1], GIFT_CODE_ALPHABET[0]);
  });

  test("keeps asking for bytes until it has twelve letters", () => {
    let calls = 0;
    const code = newGiftCode(() => {
      calls++;
      return Uint8Array.from({ length: 24 }, () => (calls < 5 ? 250 : 3));
    });
    assert.equal(calls, 5);
    assert.ok(isGiftCode(code));
  });

  test("10,000 codes are all different", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(newGiftCode());
    assert.equal(seen.size, 10_000);
  });
});

describe("isGiftCode", () => {
  test("accepts only the exact format", () => {
    assert.equal(isGiftCode("ABCD-EFGH-JKMN"), true);
    for (const bad of ["abcd-efgh-jkmn", "ABCD-EFGH-JKM", "ABCDEFGHJKMN", "ABCD-EFGH-JKM0", "ABCD-EFGH-JKMU", "ABCD-EFGH-JKMN\n", " ABCD-EFGH-JKMN", "", null, 5]) {
      assert.equal(isGiftCode(bad), false, String(bad));
    }
  });
});
