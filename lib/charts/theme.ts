/**
 * Chart theme — the validated reference palette (dataviz skill,
 * references/palette.md), light mode, applied to every ECharts option.
 * The categorical order is the CVD-safety mechanism: slots are assigned
 * per entity, in fixed order, never cycled or re-ranked on filter.
 * Validated 2026-07-23 with scripts/validate_palette.js (all checks pass;
 * the sub-3:1 contrast WARN on aqua/yellow invokes the relief rule, which
 * every chart here satisfies with in-chart value labels plus a full
 * data-table view).
 */

/**
 * Chart CHROME only — surface, gridlines, axis, axis-label ink. These are
 * not data encoding: no value is ever mapped to one of them, so they track
 * the UI palette rather than the validated categorical ramp below.
 *
 * Retuned for the Ashfield sepia token set (app/globals.css). They
 * previously held the cool-slate values, which would now leave every chart
 * sitting as a cold white rectangle inside a sheet of aged paper. Each
 * maps to its UI counterpart, and only to its UI counterpart:
 *   surface   -> --surface-raised   grid  -> (recessive paper rule)
 *   axis      -> --border-strong    muted -> --text-muted
 *   secondary -> --text-secondary   primary -> --text-primary
 *
 * Contrast against the card the chart sits on (#f8f2e4), measured:
 *   muted (axis labels, TEXT)      6.93:1  (WCAG 1.4.3, min 4.5)
 *   secondary (legend/label TEXT)  8.85:1  (WCAG 1.4.3)
 *   axis  (line, graphical)        4.61:1  (WCAG 1.4.11, min 3)
 * Gridlines stay deliberately recessive (1.24:1) — they are a decorative
 * aid with no contrast minimum, and darkening them would let chrome
 * compete with the data.
 *
 * `primary` moves from near-black to the system ink for hue only; it was
 * already well past every minimum.
 *
 * NOTE: this block is CHROME. SERIES, TRANSITION_COLORS, QUALITY_COLORS,
 * SEQUENTIAL_BLUE and DIVERGING below are data encoding — a value is
 * mapped to each of them — so the design import did not touch them and
 * must not. The categorical ramp stays CVD-validated as-is.
 */
export const INK = {
  primary: "#241f1a",
  secondary: "#4a4237",
  muted: "#5b5347",
  grid: "#ded0b0",
  axis: "#7a6c4c",
  surface: "#f8f2e4",
} as const;

/** Fixed categorical order — never reassigned when a filter removes series. */
export const SERIES = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
] as const;

/** Transition states are entities: their colors never change per chart. */
export const TRANSITION_COLORS: Record<"S00" | "S01" | "S10" | "S11", string> = {
  S00: SERIES[0],
  S01: SERIES[1],
  S10: SERIES[2],
  S11: SERIES[3],
};

/**
 * Data-quality buckets are deliberately NOT series colors — they are
 * recessive grays so "no answer" / "not comparable" never impersonates a
 * transition state (Phase 7 rule: never mis-bucketed, never dropped).
 */
export const QUALITY_COLORS = {
  MISSING_A1: "#c3c2b7",
  MISSING_A2: "#b0afa6",
  MISSING_BOTH: "#9b9992",
  NOT_COMPARABLE: "#898781",
} as const;

/** Sequential ramp (single hue, light→dark) for heatmap magnitude. */
export const SEQUENTIAL_BLUE = [
  "#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7",
  "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b",
] as const;

/**
 * Diverging pair for the opinion-shift ranking. blue = shift toward
 * "1 — Yes", orange = shift toward "0 — No", neutral gray midpoint.
 * Deliberately NOT red/green — a shift direction is not good or bad
 * (.claude/rules/analytics.md).
 */
export const DIVERGING = {
  toward1: SERIES[0],
  toward0: SERIES[1],
  midpoint: "#f0efec",
} as const;

export const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/**
 * ECharts types its formatter callbacks against broad param unions
 * (`CallbackDataParams`, `TopLevelFormatterParams`). These helpers let a
 * chart declare only the fields it actually reads and cast once, here,
 * instead of scattering casts through every component. A function whose
 * parameter is `unknown` is assignable to any of those callback types
 * (parameter contravariance), so the cast is sound at the call site.
 */
export type FormatterParams<V = number> = {
  value: V;
  dataIndex: number;
  name: string;
  seriesName?: string;
};

export function labelFormatter<V = number>(
  fn: (p: FormatterParams<V>) => string
): (params: unknown) => string {
  return fn as (params: unknown) => string;
}

export function tooltipFormatter<V = number>(
  fn: (p: FormatterParams<V>) => string
): (params: unknown) => string {
  return fn as (params: unknown) => string;
}

/** visualMap's own formatter signature (a bare value, not a params object). */
export function scaleFormatter(
  fn: (value: number) => string
): (value: unknown) => string {
  return ((value: unknown) => fn(Number(value))) as (value: unknown) => string;
}

/**
 * Tooltip `valueFormatter`. ECharts passes `OptionDataValue` (which
 * includes undefined and arrays); null/undefined must render as "—"
 * rather than "NaN%", so the narrowing happens here once.
 */
export function seriesValueFormatter(
  fn: (value: number | null) => string
): (value: unknown) => string {
  return ((value: unknown) =>
    fn(typeof value === "number" ? value : null)) as (value: unknown) => string;
}

/** Shared recessive chrome for every option: hairline grid, muted ink. */
export function baseChrome() {
  return {
    textStyle: { fontFamily: FONT_FAMILY, color: INK.secondary },
    grid: { left: 8, right: 24, top: 32, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: "#ffffff",
      borderColor: INK.grid,
      borderWidth: 1,
      textStyle: { color: INK.primary, fontFamily: FONT_FAMILY, fontSize: 12 },
      confine: true,
    },
  } as const;
}

export function categoryAxis(overrides: Record<string, unknown> = {}) {
  return {
    type: "category" as const,
    axisLine: { lineStyle: { color: INK.axis } },
    axisTick: { show: false },
    axisLabel: { color: INK.muted, fontFamily: FONT_FAMILY },
    ...overrides,
  };
}

export function valueAxis(overrides: Record<string, unknown> = {}) {
  return {
    type: "value" as const,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: INK.muted, fontFamily: FONT_FAMILY },
    splitLine: { lineStyle: { color: INK.grid, width: 1 } },
    ...overrides,
  };
}

export function percentAxis(overrides: Record<string, unknown> = {}) {
  return valueAxis({
    max: 1,
    min: 0,
    axisLabel: {
      color: INK.muted,
      fontFamily: FONT_FAMILY,
      formatter: (v: number) => `${Math.round(v * 100)}%`,
    },
    ...overrides,
  });
}

export const BAR_STYLE = {
  barMaxWidth: 22,
  itemStyle: { borderRadius: [0, 0, 0, 0] },
} as const;

export function formatPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSigned(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value}${suffix}`;
}
