/**
 * Link-type assignments (migration 0032): the assignment is a URL — in
 * practice a Google Form — that students open in a new tab. Answers,
 * identity, timing and grading all happen in the Form; this app records no
 * responses and no per-student status for it.
 *
 * The URL is not a secret. The professor hands it to the whole class, and
 * real access control is the Form's own (domain restriction, closing the
 * Form). The schedule decides when the app PRESENTS the link, nothing
 * more, and every professor-facing sentence below is worded to say exactly
 * that — never that closing the window hides or revokes the link.
 */

export type AssignmentKind = "GRID" | "LINK";

/** Hosts a Google Form link is expected on. Anything else is allowed, with
 * a warning — it may be a typo, or a deliberate non-Google link. */
export const EXPECTED_LINK_HOSTS = ["docs.google.com", "forms.gle", "drive.google.com"] as const;

export const MAX_LINK_URL_LENGTH = 2048;

/** Null when the URL is acceptable; otherwise what is wrong with it. Same
 * rule as the database's assignments_link_url_https constraint. */
export function linkUrlError(raw: string | null | undefined): string | null {
  const value = (raw ?? "").trim();
  if (value === "") return "Paste the link students should open";
  if (value.length > MAX_LINK_URL_LENGTH) return "That link is too long";
  if (/\s/.test(value)) return "A link can't contain spaces";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "That isn't a complete link — it should start with https://";
  }
  if (url.protocol !== "https:") return "The link must start with https://";
  if (!url.hostname) return "That isn't a complete link — it should start with https://";
  return null;
}

/** A gentle note for a valid https link outside the expected hosts. */
export function linkHostWarning(raw: string | null | undefined): string | null {
  if (linkUrlError(raw)) return null;
  const host = new URL((raw ?? "").trim()).hostname.toLowerCase();
  if (EXPECTED_LINK_HOSTS.some((expected) => host === expected)) return null;
  return `This isn't a Google Forms, Docs or Drive link (${host}). That's allowed — just check it's the one you meant.`;
}

const DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN || "ahduni.edu.in";

/** Shown wherever a professor creates, edits or schedules a link assignment. */
export const LINK_RESPONSES_NOTE = `Set your Form to collect email addresses and restrict it to ${DOMAIN} — this app does not record who responded.`;

export const LINK_WINDOW_NOTE =
  "The open/close window controls when this appears to students. It does not stop anyone who already has the link — close the Form in Google when you're done.";

/** Analytics, for a LINK assignment. */
export const LINK_NO_RESPONSES = "No responses are collected for this assignment.";
