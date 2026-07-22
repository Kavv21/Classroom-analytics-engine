import type { Config } from "tailwindcss";

/**
 * Token layer for the Classroom Opinion Analytics design system
 * (hand-authored for this project — see app/globals.css for the full
 * rationale and the contrast measurements behind each text colour).
 *
 * These names mirror the CSS custom properties so a component can use
 * either `bg-surface-raised` or `var(--surface-raised)` and get the same
 * value. Chart data-encoding colours are NOT here — they live in
 * lib/charts/theme.ts and are deliberately untouched.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        surface: {
          page: "var(--surface-page)",
          raised: "var(--surface-raised)",
          sunken: "var(--surface-sunken)",
          inset: "var(--surface-inset)",
          good: "var(--surface-good)",
          warning: "var(--surface-warning)",
          critical: "var(--surface-critical)",
          info: "var(--surface-info)",
        },
        ink: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          inverse: "var(--text-inverse)",
        },
        hairline: "var(--border-hairline)",
        strong: "var(--border-strong)",
        action: {
          DEFAULT: "var(--action)",
          hover: "var(--action-hover)",
        },
        good: {
          DEFAULT: "var(--status-good)",
          text: "var(--status-good-text)",
        },
        warn: {
          DEFAULT: "var(--status-warning)",
          text: "var(--status-warning-text)",
        },
        critical: {
          DEFAULT: "var(--status-critical)",
          text: "var(--status-critical-text)",
        },
        focus: "var(--focus)",
      },
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-body)",
        mono: "var(--font-mono)",
      },
      borderColor: {
        DEFAULT: "var(--border-hairline)",
      },
      transitionDuration: {
        micro: "120ms",
        disclosure: "160ms",
      },
    },
  },
  plugins: [],
};

export default config;
