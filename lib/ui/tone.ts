/**
 * The pill palette, as Tailwind class strings.
 *
 * WHAT THESE ARE FOR — and the boundary they must not cross.
 *
 * The "Meridian" direction (app/globals.css) carries several bold accent
 * hues, and they are allowed in exactly two places: UI chrome, and
 * WORKFLOW STATE. A workflow state is something the professor or the
 * system did to a record — an assignment moving DRAFT -> OPEN, an attempt
 * being submitted, an import row being rejected, a person's role. None of
 * those is an opinion, so colouring them is fine, and
 * .claude/rules/analytics.md scopes its prohibition to figures describing
 * responses.
 *
 * They are NOT for response data. Nothing that renders a student's answer,
 * a response distribution, or a consensus/disagreement/entropy figure may
 * use this module. Those stay neutral — see `.cell-toggle` in
 * app/globals.css and the untouched data-encoding palette in
 * lib/charts/theme.ts.
 *
 * Colour is never the only channel: every pill below is rendered with its
 * state spelled out in words, so the hue is redundant reinforcement rather
 * than the signal (WCAG 1.4.1).
 *
 * Each entry pairs a hue's `-soft` fill with its `-text` ink (>=5.31:1 on
 * that fill) inside its `-line` outline (>=3:1 on every surface a pill can
 * sit on). All three steps are measured by `node scripts/verify-contrast.mjs`.
 */
export const PILL = {
  orange: "border-accent-orange-line bg-accent-orange-soft text-accent-orange-text",
  green: "border-accent-green-line bg-accent-green-soft text-accent-green-text",
  blue: "border-accent-blue-line bg-accent-blue-soft text-accent-blue-text",
  purple: "border-accent-purple-line bg-accent-purple-soft text-accent-purple-text",
  pink: "border-accent-pink-line bg-accent-pink-soft text-accent-pink-text",
  amber: "border-accent-amber-line bg-accent-amber-soft text-accent-amber-text",
  red: "border-accent-red-line bg-accent-red-soft text-accent-red-text",
  slate: "border-accent-slate-line bg-accent-slate-soft text-accent-slate-text",
} as const;

export type PillTone = keyof typeof PILL;

/** For a shadcn <Badge variant="outline">, which supplies its own shape. */
export function pill(tone: PillTone): string {
  return PILL[tone];
}
