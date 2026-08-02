import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * Token layer for the Classroom Opinion Analytics design system
 * (hand-authored for this project — see app/globals.css for the full
 * rationale and the contrast measurements behind each text colour).
 *
 * Direction: "Ashfield — aged-document system" — see the header comment
 * in app/globals.css for where it came from and what was corrected.
 *
 * These names mirror the CSS custom properties so a component can use
 * either `bg-surface-raised` or `var(--surface-raised)` and get the same
 * value. The role names are unchanged from the previous system even
 * though every value behind them changed, so no component needed editing
 * to pick up the new palette. Chart data-encoding colours are NOT here —
 * they live in lib/charts/theme.ts and are deliberately untouched.
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

        /* ----------------------------------------------------------------
           shadcn/ui utility names. These resolve to the bridge variables
           in globals.css, which in turn alias the project tokens above —
           so `bg-primary` and `bg-action` are the same colour by
           construction, and there is exactly one place a colour is
           decided. Plain var() rather than hsl(var()) because the source
           tokens are hex, not HSL triplets.
           ---------------------------------------------------------------- */
        background: "rgb(var(--background) / <alpha-value>)",
        foreground: "rgb(var(--foreground) / <alpha-value>)",
        card: {
          DEFAULT: "rgb(var(--card) / <alpha-value>)",
          foreground: "rgb(var(--card-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "rgb(var(--popover) / <alpha-value>)",
          foreground: "rgb(var(--popover-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "rgb(var(--primary) / <alpha-value>)",
          foreground: "rgb(var(--primary-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "rgb(var(--secondary) / <alpha-value>)",
          foreground: "rgb(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "rgb(var(--destructive) / <alpha-value>)",
          foreground: "rgb(var(--destructive-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "rgb(var(--muted) / <alpha-value>)",
          foreground: "rgb(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          foreground: "rgb(var(--accent-foreground) / <alpha-value>)",
        },
        border: "rgb(var(--border) / <alpha-value>)",
        input: "rgb(var(--input) / <alpha-value>)",
        ring: "rgb(var(--ring) / <alpha-value>)",
        chart: {
          "1": "rgb(var(--chart-1) / <alpha-value>)",
          "2": "rgb(var(--chart-2) / <alpha-value>)",
          "3": "rgb(var(--chart-3) / <alpha-value>)",
          "4": "rgb(var(--chart-4) / <alpha-value>)",
          "5": "rgb(var(--chart-5) / <alpha-value>)",
        },
        sidebar: {
          DEFAULT: "rgb(var(--sidebar) / <alpha-value>)",
          foreground: "rgb(var(--sidebar-foreground) / <alpha-value>)",
          primary: "rgb(var(--sidebar-primary) / <alpha-value>)",
          "primary-foreground": "rgb(var(--sidebar-primary-foreground) / <alpha-value>)",
          accent: "rgb(var(--sidebar-accent) / <alpha-value>)",
          "accent-foreground": "rgb(var(--sidebar-accent-foreground) / <alpha-value>)",
          border: "rgb(var(--sidebar-border) / <alpha-value>)",
          ring: "rgb(var(--sidebar-ring) / <alpha-value>)",
        },
      },
      fontFamily: {
        display: "var(--font-display)",
        sans: "var(--font-body)",
        mono: "var(--font-mono)",
      },
      borderColor: {
        DEFAULT: "var(--border-hairline)",
        frame: "var(--border-frame)",
      },
      /* Elevation carries NO blur in this direction — a printed edge and a
         hard offset plate. Shadow is inside the motion budget: it may
         transition; size and position may not. */
      boxShadow: {
        raised: "var(--shadow-raised)",
        lifted: "var(--shadow-lifted)",
        overlay: "var(--shadow-overlay)",
      },
      /* The Ashfield system is square everywhere. Rather than edit the
         `rounded-md` / `rounded-lg` literals scattered across ~25 shadcn
         primitives (and have the next redesign edit them all back), the
         whole scale is remapped onto the radius token. `full` is left at
         Tailwind's default so avatars stay circular — the source's own
         avatar is the only round thing in it. `none` likewise stays, so an
         explicit `rounded-none` keeps meaning what it says.

         This is an `extend`, so any key not listed here (e.g. the `4xl`
         used once in components/ui/sidebar.tsx) keeps its default. */
      borderRadius: {
        sm: "var(--radius)",
        DEFAULT: "var(--radius)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-lg)",
        "2xl": "var(--radius-lg)",
        "3xl": "var(--radius-lg)",
        "4xl": "var(--radius-lg)",
      },
      transitionDuration: {
        micro: "120ms",
        disclosure: "160ms",
      },
    },
  },
  // shadcn's animation utilities. The CLI wrote a Tailwind v4 `@import
  // "tw-animate-css"` into globals.css, which cannot resolve on Tailwind
  // v3 — this plugin is the v3 equivalent.
  plugins: [tailwindcssAnimate],
};

export default config;
