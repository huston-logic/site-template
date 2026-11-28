import type { Interval } from "../../src/booking/schema.ts";

/**
 * The booking lock: one caller at a time does its check-and-write on the calendar, and the times it just claimed are
 * remembered for ten minutes so the next caller does not offer them while Google's free/busy still lacks the new event.
 * It holds nothing on disk. The logic is `LockCore` (plain, testable); `BookingLock` (lock-object.ts) runs one in a
 * Durable Object's memory and `durableLock` talks to it. This file imports nothing from `cloudflare:workers`.
 */

/** A time a caller wrote (or is about to write) to the calendar, with a reference that is not shown to anyone (an event id). */
export interface Claim extends Interval {
  ref: string;
}

export interface Lease {
  token: string;
  /** The claims of the last ten minutes, as of the moment the lock was granted. */
  claims: Claim[];
  /** Milliseconds, from the lock's clock. */
  acquiredAt: number;
}

export interface SlotLock {
  /** Waits its turn. Null when the wait went past WAIT_MS. */
  acquire(): Promise<Lease | null>;
  release(token: string, claims: Claim[]): Promise<void>;
}

/** A lease not released within this long is taken back for the next caller. */
export const LEASE_MS = 60_000;
/** A caller queued longer than this gives up (null). */
export const WAIT_MS = 25_000;
export const CLAIM_KEEP_MS = 600_000;
/** A holder this far into its lease must not start writing: the lease may be taken back before the write lands. */
export const WRITE_BY_MS = 20_000;

export function hasTimeLeft(lease: Lease, now: number): boolean {
  return now - lease.acquiredAt < WRITE_BY_MS;
}

type Timer = (fn: () => void, ms: number) => unknown;

/** A real timer that never keeps a Node test process alive (Workers has no `unref`, and does not need it). */
const defaultTimer: Timer = (fn, ms) => {
  const handle: unknown = setTimeout(fn, ms);
  if (typeof handle === "object" && handle !== null && "unref" in handle && typeof handle.unref === "function") handle.unref();
  return handle;
};

interface Waiter {
  grant: (lease: Lease) => void;
  giveUp: () => void;
  done: boolean;
}

export class LockCore {
  private holder: { token: string } | null = null;
  private queue: Waiter[] = [];
  private claims: { claim: Claim; at: number }[] = [];

  private readonly now: () => number;
  private readonly setTimer: Timer;

  constructor(now: () => number = () => Date.now(), setTimer: Timer = defaultTimer) {
    this.now = now;
    this.setTimer = setTimer;
  }

  /** First come, first served. */
  acquire(): Promise<Lease | null> {
    return new Promise((resolve) => {
      const waiter: Waiter = {
        done: false,
        grant: (lease) => {
          waiter.done = true;
          resolve(lease);
        },
        giveUp: () => {
          waiter.done = true;
          resolve(null);
        },
      };
      if (!this.holder) {
        this.grantTo(waiter);
        return;
      }
      this.queue.push(waiter);
      this.setTimer(() => {
        if (waiter.done) return;
        this.queue = this.queue.filter((other) => other !== waiter);
        waiter.giveUp();
      }, WAIT_MS);
    });
  }

  /**
   * Frees the lock when `token` is the holder. The claims are recorded either way: a holder whose lease was taken back
   * may still have written to the calendar, and an extra claim only hides a time for ten minutes (the safe direction).
   */
  release(token: string, claims: Claim[]): void {
    const at = this.now();
    for (const claim of claims) this.claims.push({ claim, at });
    if (this.holder?.token === token) {
      this.holder = null;
      this.grantNext();
    }
  }

  private grantTo(waiter: Waiter): void {
    const token = crypto.randomUUID();
    const acquiredAt = this.now();
    this.claims = this.claims.filter((entry) => acquiredAt - entry.at <= CLAIM_KEEP_MS);
    this.holder = { token };
    waiter.grant({ token, claims: this.claims.map((entry) => ({ ...entry.claim })), acquiredAt });
    this.setTimer(() => {
      if (this.holder?.token !== token) return;
      this.holder = null;
      this.grantNext();
    }, LEASE_MS);
  }

  private grantNext(): void {
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next && !next.done) {
        this.grantTo(next);
        return;
      }
    }
  }
}

export function memoryLock(core: LockCore = new LockCore()): SlotLock {
  return {
    acquire: () => core.acquire(),
    release: async (token, claims) => core.release(token, claims),
  };
}

/** The methods the Durable Object exposes over JS RPC (lock-object.ts). */
interface LockStub {
  acquire(): Promise<Lease | null>;
  release(token: string, claims: Claim[]): Promise<void>;
}

/** The site's one lock object, or null without the binding (the routes then fail closed). */
export function durableLock(namespace: DurableObjectNamespace | undefined): SlotLock | null {
  if (!namespace) return null;
  const stub = (): LockStub => namespace.get(namespace.idFromName("booking")) as unknown as LockStub;
  return {
    acquire: () => stub().acquire(),
    release: (token, claims) => stub().release(token, claims),
  };
}
