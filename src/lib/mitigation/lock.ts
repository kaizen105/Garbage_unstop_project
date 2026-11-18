import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

/**
 * Concurrency Lock for Mitigation Plan Generation
 *
 * Why session-level advisory locks (e.g. pg_try_advisory_lock) are unsafe with Neon:
 * Neon uses PgBouncer in transaction pooling mode. In transaction pooling, a client's
 * logical connection to PgBouncer can be mapped to different physical PostgreSQL backend
 * connections between queries and transactions. Session-level advisory locks are bound
 * to the physical backend connection, which causes two critical issues:
 * 1) A lock acquired in one query remains on a backend connection returned to the pool,
 *    blocking subsequent queries on that backend connection or leaking locks indefinitely.
 * 2) An unlock attempt in a subsequent query may execute on a different backend connection,
 *    failing to release the lock.
 * Furthermore, holding a transaction-level lock (pg_try_advisory_xact_lock) during an LLM call
 * (10 to 30 seconds) holds an active connection in the pool, exhausting available pool connections.
 *
 * Therefore, we use an atomic database row lock with a 60-second TTL stored in the RateLimit
 * table (key: "lock:mitigation"). This provides:
 * - Instant lock release upon completion via delete.
 * - Automatic expiration after 60 seconds if the serverless process crashes mid-generation.
 * - Safe operation across serverless instances and connection poolers without holding DB connections open during LLM calls.
 * - Explicit fail-open behavior on database errors so transient DB issues do not block generation.
 */

const DEFAULT_LOCK_KEY = "lock:mitigation";
const DEFAULT_LOCK_TTL_MS = 60 * 1000; // 60 seconds
const LOCK_WINDOW_START = new Date(0); // Fixed epoch ensuring @@unique([key, windowStart]) acts as unique lock key

export async function tryAcquireMitigationLock(
  lockKey: string = DEFAULT_LOCK_KEY,
  ttlMs: number = DEFAULT_LOCK_TTL_MS
): Promise<boolean> {
  const now = new Date();
  const expiresBefore = new Date(now.getTime() - ttlMs);

  try {
    // 1. Clear expired lock if one exists from an ungraceful crash or timeout
    await prisma.rateLimit.deleteMany({
      where: {
        key: lockKey,
        updatedAt: { lt: expiresBefore },
      },
    });

    // 2. Attempt to create the lock record atomically
    await prisma.rateLimit.create({
      data: {
        key: lockKey,
        count: 1,
        windowStart: LOCK_WINDOW_START,
      },
    });

    return true;
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Lock is currently held by another active generation process
      return false;
    }
    // Fail-open: allow generation to proceed if database lock operation fails unexpectedly
    console.error("Mitigation lock acquisition failed due to DB error, failing open:", err);
    return true;
  }
}

export async function releaseMitigationLock(lockKey: string = DEFAULT_LOCK_KEY): Promise<void> {
  try {
    await prisma.rateLimit.deleteMany({
      where: { key: lockKey },
    });
  } catch (err: unknown) {
    console.error("Failed to release mitigation lock:", err);
  }
}
