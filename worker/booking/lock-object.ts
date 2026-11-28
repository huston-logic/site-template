import { DurableObject } from "cloudflare:workers";
import { LockCore } from "./lock.ts";
import type { Claim, Lease } from "./lock.ts";

/**
 * The booking lock as a Durable Object: one per site, with the lock held in memory only (no storage). Only
 * `worker/index.ts` imports this file, so the Node tests never load `cloudflare:workers`.
 */
export class BookingLock extends DurableObject {
  private readonly core = new LockCore();

  acquire(): Promise<Lease | null> {
    return this.core.acquire();
  }

  release(token: string, claims: Claim[]): void {
    this.core.release(token, claims);
  }
}
