/**
 * Per-user rate limiting for the highest-frequency, highest-stakes writes.
 *
 * STORAGE CHOICE — in-memory fixed window, and the tradeoff.
 *
 * This keeps counters in a module-level Map, which on Vercel means one
 * counter set per serverless/edge isolate. That is deliberate:
 *
 *   + No new infrastructure, no external service, and — critically — no
 *     network round-trip on the very requests we are protecting. A Redis
 *     lookup in middleware would add latency to every autosave, which is
 *     the opposite of the goal.
 *   + It reliably stops the realistic failure mode: one client stuck in a
 *     retry loop hammering autosave, or a single student's tab
 *     multiplying requests. That is what actually threatens a class of
 *     300 mid-assignment.
 *   - It is NOT a global guarantee. Vercel may run several isolates, and
 *     each holds its own counters, so a determined attacker spreading
 *     requests across isolates gets a higher effective limit. Counters
 *     also reset on cold start.
 *
 * If a global guarantee is ever needed (abuse rather than accident), swap
 * `hit()` for an Upstash/Vercel KV implementation — the interface is
 * deliberately narrow so that is a one-file change. Documented in
 * docs/SECURITY.md.
 *
 * Keyed by authenticated user id, never IP: students share a university
 * network, so an IP-keyed limit would throttle a whole lecture hall
 * because one person's client misbehaved.
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the window resets — used for Retry-After. */
  retryAfterSeconds: number;
}

interface Counter {
  count: number;
  resetAt: number;
}

const counters = new Map<string, Counter>();

/**
 * Bounded cleanup so a long-lived isolate cannot accumulate keys for
 * users who have gone away. Runs opportunistically, not on a timer —
 * middleware has no lifecycle hooks to cancel one.
 */
function sweep(now: number): void {
  if (counters.size < 5000) return;
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) counters.delete(key);
  }
}

export function hit(key: string, rule: RateLimitRule, now = Date.now()): RateLimitResult {
  sweep(now);

  const existing = counters.get(key);
  if (!existing || existing.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + rule.windowMs });
    return {
      allowed: true,
      limit: rule.limit,
      remaining: rule.limit - 1,
      retryAfterSeconds: Math.ceil(rule.windowMs / 1000),
    };
  }

  existing.count += 1;
  const remaining = Math.max(0, rule.limit - existing.count);
  return {
    allowed: existing.count <= rule.limit,
    limit: rule.limit,
    remaining,
    retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
  };
}

/** Test seam — the counters are module state. */
export function resetAllLimits(): void {
  counters.clear();
}

// ---------------------------------------------------------------- rules --

/**
 * Autosave. The client debounces at 800ms and batches every pending
 * answer into one call, so a student answering as fast as they can read
 * generates well under 1 request/second. 120/minute leaves roughly a 2x
 * margin over the worst honest case (rapid clicking plus the retry queue
 * flushing after a reconnect) while still cutting off a runaway loop.
 */
export const AUTOSAVE_RULE: RateLimitRule = { limit: 120, windowMs: 60_000 };

/**
 * Submission. A student submits once, occasionally twice after a
 * professor reopens. The database already rejects a second submission
 * with ALREADY_SUBMITTED, so this only exists to stop a hot loop.
 */
export const SUBMIT_RULE: RateLimitRule = { limit: 20, windowMs: 60_000 };

/**
 * Everything else a signed-in user can POST (creating classes, importing,
 * approving mappings, running builder queries). Generous, because a
 * professor importing a roster legitimately fires several in a row.
 */
export const GENERAL_WRITE_RULE: RateLimitRule = { limit: 300, windowMs: 60_000 };

export type RateLimitBucket = "autosave" | "submit" | "general";

/**
 * Which bucket a request falls into, from its path.
 *
 * Autosave and submission are Next.js Server Actions, so they arrive as
 * POSTs to the page they were invoked from rather than to a dedicated
 * endpoint — `/assignments/{id}` for autosave and `/assignments/{id}/review`
 * for submission. Matching on the path is therefore how a Server Action
 * is identified in middleware; the `Next-Action` header carries only a
 * build-specific hash, which is not stable enough to key on.
 */
export function bucketForPath(pathname: string): RateLimitBucket {
  if (/^\/assignments\/[^/]+\/review\/?$/.test(pathname)) return "submit";
  if (/^\/assignments\/[^/]+\/?$/.test(pathname)) return "autosave";
  return "general";
}

export const RULES: Record<RateLimitBucket, RateLimitRule> = {
  autosave: AUTOSAVE_RULE,
  submit: SUBMIT_RULE,
  general: GENERAL_WRITE_RULE,
};
