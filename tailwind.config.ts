import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

/**
 * Token layer for the Classroom Opinion Analytics design system
 * (hand-authored for this project — see app/globals.css for the full
 * rationale and the contrast measurements behind each colour, and
 * `node scripts/verify-contrast.mjs` for the measurements themselves).
 *
 * Direction: "Meridian — warm SaaS console" — see the header comment in
 * app/globals.css for where it came from and what was corrected.
 *
 * These names mirror the CSS custom properties so a component can use
 * either `bg-surface-raised` or `var(--surface-raised)` and get the same
 * value. The role names are unchanged from the previous system even
 * though every value behind them changed, so no component needed editing
 * to pick up the new palette. Chart data-encoding colours are NOT here —
 * they live in lib/charts/theme.ts and are deliberately untouched.
 */
const config: Config = {
  /* `./lib` is in here for a reason. The pill palette (lib/ui/tone.ts), the
     assignment-status tones (lib/ui/labels.ts) and the avatar tones
     (lib/ui/avatar-tone.ts) are Tailwind class STRINGS that no file under
     ./app or ./components spells out literally — they are imported as
     values. Without this glob Tailwind never sees them, generates no rule,
     and every one of those utilities resolves to nothing at runtime: no
     warning, no error, just an uncoloured badge. The `bg-accent-*` family
     was silently missing from the first build of this direction for
     exactly that reason.

     Verify after a build, don't assume:
       grep -o "\.bg-accent-orange-soft{[^}]*}" .next/static/css/*.css */
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          /* DEFAULT exists on purpose. Without it a bare `bg-surface`
             compiles to NOTHING — no warning, no rule, just a transparent
             element — which is exactly how the sticky row-header column on
             both grid tables silently broke during the Ashfield pass.
             `ink` has always had a DEFAULT; the asymmetry was the trap. */
          DEFAULT: "var(--surface-raised)",
          backdrop: "var(--surface-backdrop)",
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

        /* ----------------------------------------------------------------
           The accent families. Four steps per hue, named for the JOB the
           step is contrast-qualified for, not for a lightness number:

             soft   fill only (decorative, no minimum)
             line   outline / meaningful glyph  >=3:1 on every surface
             text   text                        >=4.5:1 on every surface
             solid  fill carrying WHITE text    >=4.5:1

           UI chrome and workflow state only. Never a response value, a
           distribution or a consensus figure — see the boundary note at
           the top of app/globals.css and .claude/rules/analytics.md.
           ---------------------------------------------------------------- */
        accent: {
          orange: {
            soft: "var(--accent-orange-soft)",
            line: "var(--accent-orange-line)",
            text: "var(--accent-orange-text)",
            solid: "var(--accent-orange-solid)",
          },
          green: {
            soft: "var(--accent-green-soft)",
            line: "var(--accent-green-line)",
            text: "var(--accent-green-text)",
            solid: "var(--accent-green-solid)",
          },
          blue: {
            soft: "var(--accent-blue-soft)",
            line: "var(--accent-blue-line)",
            text: "var(--accent-blue-text)",
            solid: "var(--accent-blue-solid)",
          },
          purple: {
            soft: "var(--accent-purple-soft)",
            line: "var(--accent-purple-line)",
            text: "var(--accent-purple-text)",
            solid: "var(--accent-purple-solid)",
          },
          pink: {
            soft: "var(--accent-pink-soft)",
            line: "var(--accent-pink-line)",
            text: "var(--accent-pink-text)",
            solid: "var(--accent-pink-solid)",
          },
          amber: {
            soft: "var(--accent-amber-soft)",
            line: "var(--accent-amber-line)",
            text: "var(--accent-amber-text)",
            solid: "var(--accent-amber-solid)",
          },
          red: {
            soft: "var(--accent-red-soft)",
            line: "var(--accent-red-line)",
            text: "var(--accent-red-text)",
            solid: "var(--accent-red-solid)",
          },
          slate: {
            soft: "var(--accent-slate-soft)",
            line: "var(--accent-slate-line)",
            text: "var(--accent-slate-text)",
            solid: "var(--accent-slate-solid)",
          },

          /* shadcn's own `accent` slot. It predates the families above and
             several primitives resolve `bg-accent` / `text-accent-foreground`
             for hover states, so it has to stay a DEFAULT on this key. */
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          foreground: "rgb(var(--accent-foreground) / <alpha-value>)",
        },

        /* Rail tokens, for the one component that lives on the dark
           surface. Kept separate from the accents because their contrast
           was qualified against navy, not against paper. */
        rail: {
          DEFAULT: "var(--sidebar-surface)",
          hover: "var(--sidebar-hover)",
          idle: "var(--sidebar-idle)",
          active: "var(--sidebar-active)",
          "active-ink": "var(--sidebar-active-ink)",
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
        focus: {
          DEFAULT: "var(--focus)",
          dark: "var(--focus-on-dark)",
        },

        /* ----------------------------------------------------------------
           shadcn/ui utility names. These resolve to the bridge variables
           in globals.css, which in turn alias the project tokens above —
           so `bg-primary` and `bg-action` are the same colour by
           construction, and there is exactly one place a colour is
           decided.
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
      /* Soft and blurred, replacing the Ashfield hard offset plates.
         Shadow is inside the motion budget: it may transition; size and
         position may not. */
      boxShadow: {
        raised: "var(--shadow-raised)",
        lifted: "var(--shadow-lifted)",
        overlay: "var(--shadow-overlay)",
        frame: "var(--shadow-frame)",
      },
      /* The whole rounded-* scale is remapped onto the radius tokens, the
         same lever that took the Ashfield direction square without editing
         the `rounded-md` / `rounded-lg` literals scattered across ~25
         shadcn primitives. This direction is round again, so the tokens
         carry real values instead of 0 — which is the entire diff for
         those 25 files.

         `full` and `none` keep Tailwind's defaults so avatars stay
         circular and an explicit `rounded-none` still means what it says.
         This is an `extend`, so any key not listed keeps its default. */
      borderRadius: {
        sm: "calc(var(--radius) - 2px)",
        DEFAULT: "var(--radius)",
        md: "var(--radius)",
        lg: "var(--radius-lg)",
        xl: "calc(var(--radius-lg) + 4px)",
        "2xl": "var(--radius-frame)",
        "3xl": "var(--radius-frame)",
        /* badge.tsx reaches for `rounded-4xl` to make a pill; at a 20px
           badge height this radius rounds it fully. */
        "4xl": "9999px",
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
