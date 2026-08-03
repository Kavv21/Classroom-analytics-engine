"use client";

import { useEffect, useState } from "react";

/**
 * A timestamp shown in the reader's own timezone.
 *
 * WHY THIS EXISTS
 * `new Date(x).toLocaleString()` called during render reads the timezone
 * and locale of whatever is doing the rendering. On the server that is
 * Vercel's clock (UTC, en-US); in the browser it is the professor's. The
 * two strings disagree, and the consequence depends on where the call was:
 *
 *   - In a CLIENT component the string is produced twice, once into the
 *     SSR HTML and once during hydration. React finds a text node it did
 *     not expect and fails hydration with error #418, discarding the
 *     server HTML and re-rendering the entire root on the client. That is
 *     a silent, whole-page failure caused by one table cell.
 *   - In a SERVER component it hydrates cleanly and is simply wrong: every
 *     professor is shown UTC, unlabelled, as if it were their local time.
 *
 * So render a fixed UTC label that both sides agree on, then swap to the
 * reader's local formatting in an effect — which only ever runs in the
 * browser, and so cannot disagree with anything.
 */

/**
 * ISO -> "2026-08-03 19:37 UTC". Built from `toISOString`, not `Intl`, so
 * it cannot vary with the platform's locale data either — the whole point
 * of this string is that two different machines produce it identically.
 */
export function utcLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

export function LocalDateTime({
  value,
  fallback = "—",
  className,
}: {
  value: string | null | undefined;
  /** Shown when there is no timestamp at all. */
  fallback?: string;
  className?: string;
}) {
  // `null` means "not yet mounted", which is also exactly the state the
  // server renders in, so the first client render matches the HTML.
  const [local, setLocal] = useState<string | null>(null);

  useEffect(() => {
    if (!value) return;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return;
    setLocal(date.toLocaleString());
  }, [value]);

  if (!value) return <>{fallback}</>;

  return (
    <time dateTime={value} className={className}>
      {local ?? utcLabel(value)}
    </time>
  );
}
