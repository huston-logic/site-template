import assert from "node:assert/strict";
import { test } from "node:test";
import { CLAIM_KEEP_MS, hasTimeLeft, LEASE_MS, LockCore, memoryLock, WAIT_MS, WRITE_BY_MS } from "./lock.ts";
import type { Claim, Lease } from "./lock.ts";

/** A clock and timers the test moves by hand. */
function fakeTime() {
  let clock = 1_000_000;
  const timers: { at: number; fn: () => void }[] = [];
  return {
    now: () => clock,
    setTimer: (fn: () => void, ms: number) => {
      timers.push({ at: clock + ms, fn });
      return timers.length;
    },
    async advance(ms: number) {
      const target = clock + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        const next = timers[0];
        if (!next || next.at > target) break;
        timers.shift();
        clock = next.at;
        next.fn();
        await Promise.resolve();
      }
      clock = target;
      await Promise.resolve();
    },
  };
}

const claim = (start: number, ref = "e1"): Claim => ({ start, end: start + 3_600_000, ref });
const settled = async <T>(promise: Promise<T>): Promise<{ done: boolean; value?: T }> => {
  let done = false;
  let value: T | undefined;
  void promise.then((v) => {
    done = true;
    value = v;
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { done, value };
};

test("the second caller waits until the first releases", async () => {
  const time = fakeTime();
  const core = new LockCore(time.now, time.setTimer);
  const first = await core.acquire();
  assert.ok(first);
  const second = core.acquire();
  assert.equal((await settled(second)).done, false);
  core.release(first.token, []);
  const lease = await second;
  assert.ok(lease);
  assert.notEqual(lease.token, first.token);
});

test("waiters are served in the order they came", async () => {
  const time = fakeTime();
  const core = new LockCore(time.now, time.setTimer);
  const a = await core.acquire();
  const b = core.acquire();
  const c = core.acquire();
  assert.ok(a);
  core.release(a.token, []);
  const leaseB = await b;
  assert.ok(leaseB);
  assert.equal((await settled(c)).done, false);
  core.release(leaseB.token, []);
  assert.ok(await c);
});

test("a lease not released in 60 seconds is taken back and the next waiter gets the lock", async () => {
  const time = fakeTime();
  const core = new LockCore(time.now, time.setTimer);
  const first = await core.acquire();
  assert.ok(first);
  const second = core.acquire();
  await time.advance(WAIT_MS - 1);
  assert.equal((await settled(second)).done, false);
  // The second caller gives up at WAIT_MS, before the lease runs out; a third one asked later outlasts it.
  await time.advance(1);
  assert.equal(await second, null);
  // Asked 20 seconds before the lease runs out, so its own 25-second wait outlasts the lease.
  await time.advance(LEASE_MS - WAIT_MS - 20_000);
  const third = core.acquire();
  assert.equal((await settled(third)).done, false);
  await time.advance(20_000);
  assert.ok(await third);
});

test("a stale release frees nothing but its claims are still remembered", async () => {
  const time = fakeTime();
  const core = new LockCore(time.now, time.setTimer);
  const first = await core.acquire();
  assert.ok(first);
  await time.advance(LEASE_MS);
  const second = await core.acquire();
  assert.ok(second);
  core.release(first.token, [claim(5_000_000, "late")]);
  const third = core.acquire();
  assert.equal((await settled(third)).done, false, "the second holder still has the lock");
  core.release(second.token, []);
  const lease = await third;
  assert.deepEqual(lease?.claims.map((c) => c.ref), ["late"]);
});

test("claims are kept for ten minutes and handed to the next holder", async () => {
  const time = fakeTime();
  const core = new LockCore(time.now, time.setTimer);
  const first = await core.acquire();
  assert.ok(first);
  assert.deepEqual(first.claims, []);
  core.release(first.token, [claim(9_000_000)]);
  await time.advance(CLAIM_KEEP_MS - 1000);
  const second = await core.acquire();
  assert.equal(second?.claims.length, 1);
  assert.equal(second?.claims[0]?.start, 9_000_000);
  core.release((second as Lease).token, []);
  await time.advance(2000);
  const third = await core.acquire();
  assert.deepEqual(third?.claims, []);
});

test("a waiter past WAIT_MS gets null and is not served later", async () => {
  const time = fakeTime();
  const core = new LockCore(time.now, time.setTimer);
  const first = await core.acquire();
  assert.ok(first);
  const second = core.acquire();
  await time.advance(WAIT_MS);
  assert.equal(await second, null);
  core.release(first.token, []);
  const third = await core.acquire();
  assert.ok(third);
});

test("hasTimeLeft is true before WRITE_BY_MS of the lease and false from then on", () => {
  const lease: Lease = { token: "t", claims: [], acquiredAt: 100 };
  assert.equal(hasTimeLeft(lease, 100 + WRITE_BY_MS - 1), true);
  assert.equal(hasTimeLeft(lease, 100 + WRITE_BY_MS), false);
});

test("memoryLock wraps a core", async () => {
  const time = fakeTime();
  const lock = memoryLock(new LockCore(time.now, time.setTimer));
  const lease = await lock.acquire();
  assert.ok(lease);
  const next = lock.acquire();
  await lock.release(lease.token, [claim(1)]);
  const second = await next;
  assert.equal(second?.claims.length, 1);
});
