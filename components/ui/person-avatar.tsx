import { cn } from "@/lib/utils";
import { avatarToneClass, initialsFrom } from "@/lib/ui/avatar-tone";

/**
 * A person, as a coloured circle of initials.
 *
 * Deliberately NOT built on components/ui/avatar.tsx: that one wraps Radix
 * AvatarPrimitive, which exists to manage the loading/fallback state of a
 * remote IMAGE. This app has no profile images — there is nowhere to
 * upload one and no column to store one — so every avatar it can ever
 * render is the fallback. A plain span costs no client bundle and, having
 * no hooks and no context, drops straight into the server components that
 * render the roster and the class detail page without pulling them across
 * the client boundary.
 *
 * The circle's hue is decorative and identity-stable only (see
 * lib/ui/avatar-tone.ts) — it encodes nothing, least of all anything about
 * the person's responses. The initials are always drawn, and the full name
 * is always available as the accessible name, so the colour is never
 * carrying information on its own.
 */
export function PersonAvatar({
  fullName,
  email,
  size = "default",
  className,
}: {
  fullName: string | null;
  email: string;
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const sizes = {
    sm: "size-6 text-[0.625rem]",
    default: "size-8 text-xs",
    lg: "size-10 text-sm",
  };
  return (
    <span
      // `title` rather than aria-label: this is decorative next to a name
      // that is already in the row, and an aria-label here would make a
      // screen reader announce the person twice.
      title={fullName ?? email}
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold select-none",
        sizes[size],
        avatarToneClass(email),
        className
      )}
    >
      {initialsFrom(fullName, email)}
    </span>
  );
}

/** An avatar beside the person's name — the roster's primary cell. */
export function PersonChip({
  fullName,
  email,
  secondary,
  size = "default",
}: {
  fullName: string | null;
  email: string;
  secondary?: string | null;
  size?: "sm" | "default" | "lg";
}) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <PersonAvatar fullName={fullName} email={email} size={size} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium">{fullName ?? email}</span>
        {secondary ? (
          <span className="truncate text-xs text-ink-muted">{secondary}</span>
        ) : null}
      </span>
    </span>
  );
}

/**
 * Several people at once, as overlapping circles with a "+N" tail.
 *
 * The stack is a visual summary, not a substitute for the list — every
 * person it counts is also rendered in full in the table beneath it, and
 * the whole group carries one accessible label giving the real total, so a
 * screen reader gets the count rather than a run of initials.
 */
export function PeopleStack({
  people,
  max = 5,
  label,
}: {
  people: { fullName: string | null; email: string }[];
  max?: number;
  label: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    <span className="flex items-center" role="img" aria-label={label}>
      {shown.map((p) => (
        <PersonAvatar
          key={p.email}
          fullName={p.fullName}
          email={p.email}
          size="sm"
          className="-ml-1.5 ring-2 ring-[color:var(--surface-raised)] first:ml-0"
        />
      ))}
      {rest > 0 && (
        <span
          aria-hidden="true"
          className="-ml-1.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-slate-soft text-[0.625rem] font-semibold text-accent-slate-text ring-2 ring-[color:var(--surface-raised)]"
        >
          +{rest}
        </span>
      )}
    </span>
  );
}
