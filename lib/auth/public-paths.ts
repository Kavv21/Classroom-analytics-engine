/**
 * Route classification for the auth middleware. Kept as pure functions,
 * separate from middleware.ts, so the routing rules can be unit tested
 * without mocking Supabase or the Next.js request/response cycle.
 */

/** Reachable with no session at all. */
const UNAUTHENTICATED_PATHS = ["/login", "/auth/callback"];

/** Reachable with a session but no `profiles` row yet. */
const UNPROVISIONED_PATHS = ["/not-provisioned"];

function matches(pathname: string, paths: string[]): boolean {
  return paths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isUnauthenticatedPath(pathname: string): boolean {
  return matches(pathname, UNAUTHENTICATED_PATHS);
}

export function isUnprovisionedPath(pathname: string): boolean {
  return matches(pathname, UNPROVISIONED_PATHS);
}
