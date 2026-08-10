/**
 * Route classification for the auth middleware. Kept as pure functions,
 * separate from middleware.ts, so the routing rules can be unit tested
 * without mocking Supabase or the Next.js request/response cycle.
 */

/** Reachable with no session at all. */
const UNAUTHENTICATED_PATHS = ["/login", "/auth/callback"];

/** Reachable with a session but no `profiles` row yet. */
const UNPROVISIONED_PATHS = ["/not-provisioned"];

/**
 * Reachable in *every* auth state, and never redirected in either
 * direction. This is different from UNAUTHENTICATED_PATHS: those are
 * signed-out-only, and a signed-in caller hitting one is bounced to `/`.
 * A machine endpoint has no such notion of "already signed in, go home" —
 * it must answer the same way to everyone, so it skips the session check
 * entirely rather than being classified by it.
 */
const ALWAYS_PUBLIC_PATHS = ["/api/health"];

function matches(pathname: string, paths: string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isUnauthenticatedPath(pathname: string): boolean {
  return matches(pathname, UNAUTHENTICATED_PATHS);
}

export function isUnprovisionedPath(pathname: string): boolean {
  return matches(pathname, UNPROVISIONED_PATHS);
}

export function isAlwaysPublicPath(pathname: string): boolean {
  return matches(pathname, ALWAYS_PUBLIC_PATHS);
}
