import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { clearFields, firstReport, loadFields, recalledSessionId, rememberSessionId, REPORTED_KEEP, REPORTED_KEY, saveFields, SAVED_FIELDS_KEY, type StorageLike } from "./browser-storage.ts";
import { emptyValues, type GiftCardValues } from "./form-check.ts";

const memory = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => void map.set(key, value), removeItem: (key) => void map.delete(key) };
};
const broken: StorageLike = {
  getItem: () => {
    throw new Error("storage is off");
  },
  setItem: () => {
    throw new Error("storage is off");
  },
  removeItem: () => {
    throw new Error("storage is off");
  },
};
const values: GiftCardValues = { ...emptyValues, choice: "other", custom: "75", buyerName: "Ada", buyerEmail: "ada@example.test", recipientName: "Grace", message: "Hello" };

describe("saved fields", () => {
  test("what is saved comes back the same", () => {
    const storage = memory();
    saveFields(storage, values);
    assert.deepEqual(loadFields(storage), values);
  });

  test("nothing saved, no storage, broken storage or edited junk all give null", () => {
    assert.equal(loadFields(memory()), null);
    assert.equal(loadFields(null), null);
    assert.equal(loadFields(broken), null);
    const storage = memory();
    storage.map.set(SAVED_FIELDS_KEY, "not json");
    assert.equal(loadFields(storage), null);
    storage.map.set(SAVED_FIELDS_KEY, JSON.stringify({ ...values, message: 5 }));
    assert.equal(loadFields(storage), null);
    storage.map.set(SAVED_FIELDS_KEY, JSON.stringify([1]));
    assert.equal(loadFields(storage), null);
  });

  test("clearing forgets them, and a failing storage does not throw", () => {
    const storage = memory();
    saveFields(storage, values);
    clearFields(storage);
    assert.equal(loadFields(storage), null);
    assert.doesNotThrow(() => clearFields(broken));
    assert.doesNotThrow(() => clearFields(null));
  });

  test("a failing write does not throw, and a huge value is capped when read", () => {
    assert.doesNotThrow(() => saveFields(broken, values));
    const storage = memory();
    storage.map.set(SAVED_FIELDS_KEY, JSON.stringify({ ...values, buyerName: "x".repeat(5000), message: "y".repeat(5000) }));
    const loaded = loadFields(storage);
    assert.equal(loaded?.buyerName.length, 300);
    assert.equal(loaded?.message.length, 301);
  });
});

describe("firstReport", () => {
  test("true once per transaction, false after, and other transactions are separate", () => {
    const storage = memory();
    assert.equal(firstReport(storage, "pi_1"), true);
    assert.equal(firstReport(storage, "pi_1"), false);
    assert.equal(firstReport(storage, "pi_2"), true);
    assert.equal(firstReport(storage, "pi_1"), false);
  });

  test("only the newest purchases are remembered", () => {
    const storage = memory();
    for (let n = 0; n < REPORTED_KEEP + 5; n += 1) firstReport(storage, `pi_${n}`);
    assert.equal((JSON.parse(storage.map.get(REPORTED_KEY) ?? "[]") as string[]).length, REPORTED_KEEP);
  });

  test("without usable storage it reports, and a damaged record still reports", () => {
    assert.equal(firstReport(null, "pi_1"), true);
    assert.equal(firstReport(broken, "pi_1"), true);
    const storage = memory();
    storage.map.set(REPORTED_KEY, "{oops");
    assert.equal(firstReport(storage, "pi_1"), true);
  });
});

describe("the checkout session id kept for this tab", () => {
  test("what is remembered comes back; nothing, junk, no storage or broken storage give null", () => {
    const storage = memory();
    assert.equal(recalledSessionId(storage), null);
    rememberSessionId(storage, "cs_test_a1B2");
    assert.equal(recalledSessionId(storage), "cs_test_a1B2");
    storage.setItem("hl-gift-card-session", "<script>");
    assert.equal(recalledSessionId(storage), null);
    assert.equal(recalledSessionId(null), null);
    assert.equal(recalledSessionId(broken), null);
    assert.doesNotThrow(() => rememberSessionId(broken, "cs_test_a"));
    assert.doesNotThrow(() => rememberSessionId(null, "cs_test_a"));
  });
});
