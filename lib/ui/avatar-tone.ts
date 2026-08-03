/**
 * Deterministic accent assignment for an avatar circle.
 *
 * The design direction represents people with coloured avatar circles that
 * can stack. The colour is decoration and identity-stability only — it
 * carries no meaning, is never the sole channel for anything, and is never
 * derived from a response, a role's permissions, or any student data.
 * Every avatar also renders the person's initials, and its accessible name
 * is their full name or email.
 *
 * Deterministic rather than random so the same person keeps the same
 * colour across the roster, the analytics student list and their profile
 * page — a person whose circle changed hue between screens would read as
 * two different people.
 *
 * Each tone resolves to an accent family whose `-text` step is >=4.5:1 on
 * its own `-soft` fill (measured in scripts/verify-contrast.mjs), so the
 * initials always clear WCAG 1.4.3 whichever tone a name lands on.
 */
export const AVATAR_TONES = [
  "orange",
  "green",
  "blue",
  "purple",
  "pink",
  "amber",
] as const;

export type AvatarTone = (typeof AVATAR_TONES)[number];

/** FNV-1a — stable across processes, unlike String.prototype.hashCode-alikes. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function avatarTone(seed: string): AvatarTone {
  return AVATAR_TONES[hash(seed) % AVATAR_TONES.length]!;
}

/** Tailwind classes for the circle, keyed by tone. */
export const AVATAR_TONE_CLASS: Record<AvatarTone, string> = {
  orange: "bg-accent-orange-soft text-accent-orange-text",
  green: "bg-accent-green-soft text-accent-green-text",
  blue: "bg-accent-blue-soft text-accent-blue-text",
  purple: "bg-accent-purple-soft text-accent-purple-text",
  pink: "bg-accent-pink-soft text-accent-pink-text",
  amber: "bg-accent-amber-soft text-accent-amber-text",
};

export function avatarToneClass(seed: string): string {
  return AVATAR_TONE_CLASS[avatarTone(seed)];
}

/** Up to two initials from a name, falling back to the email local part. */
export function initialsFrom(fullName: string | null, email: string): string {
  const source = fullName?.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}
