import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

/**
 * The sign-in screen: the app's front door, and the only page most people
 * see before they are anyone in particular.
 *
 * Composition under the "Meridian" direction: this is one of the three
 * screens (sign-in / not-provisioned / receipt) that sit directly on the
 * peach backdrop rather than inside the floating app frame, because there
 * is no navigation to put in a rail for someone who is not yet anyone in
 * particular. They share one shape — a lifted white card on the backdrop,
 * carrying an eyebrow, a headline, a short lede, the action, and a
 * hairline-separated line of fine print.
 *
 * This screen is the one deliberate departure from that shape: the brand
 * statement was moved up into the masthead, so the card drops its eyebrow
 * and takes a plain small "Sign in" heading instead of an eyebrow plus a
 * display-sized headline. The sibling screens keep the original pairing.
 *
 * The masthead is transparent here, so the backdrop shows through behind
 * the wordmark, and on this screen it is centred across the full page
 * width rather than left-aligned; the footer line takes an explicit
 * secondary ink because the muted default is only 3.88:1 on that backdrop.
 *
 * The domain line comes from NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN, never from a
 * literal in this file, so a deployment for another Google Workspace names
 * its own domain. Note that Next inlines NEXT_PUBLIC_* at build time even in
 * server components, so changing the domain needs a redeploy, not just an
 * env edit — the same is already true of the `hd` hint in
 * GoogleSignInButton. If the variable is unset the line is omitted entirely:
 * better silent than claiming a restriction we cannot name.
 *
 * Either way it is a courtesy, not the boundary. The real domain check is
 * server-side in handle_new_user() against app_config, which is read live
 * (docs/AUTH_SSO.md section 1).
 */

const ALLOWED_DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN;

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col">
      {/* The masthead carries the brand statement now, centred across the full
          page width. The flex row is gone because it held one child and its
          `items-baseline gap-3` only ever mattered for a second one: a plain
          block with `text-center` centres the inline wordmark and, at widths
          where it wraps, centres each line against the others rather than
          centring one left-aligned box. Styling is untouched — same `wordmark`
          role (display face, bold, uppercase, 0.06em tracking) at the same
          text-lg. */}
      <header className="masthead px-6 py-5 text-center sm:px-10">
        <span className="wordmark text-lg">FUTURETECTURE EVALUATING ENERGY SOURCES</span>
      </header>

      <main className="flex flex-1 items-center px-6 py-16 sm:px-10">
        <div className="card-elevated w-full max-w-xl">
          {/* The brand statement now lives in the masthead, so the card's own
              heading is just the task at hand. The "SIGN IN" eyebrow that used
              to sit above it is gone rather than kept: its job was to label a
              card whose headline was the product name, and once the headline
              *is* "Sign in" the two lines say the same word twice. This stays
              the page's only <h1> — the masthead is a wordmark, not a heading,
              so removing this would leave the document with no h1 at all. */}
          <h1 className="title-sm">Sign in</h1>

          <p className="lede mt-4 max-w-[46ch] text-pretty">
            Use your university Google account. If you&rsquo;re a student, your professor adds you to
            a class roster before your first sign-in.
          </p>

          <div className="mt-9">
            <GoogleSignInButton />
          </div>

          {ALLOWED_DOMAIN && (
            <p className="note-muted mt-7 border-t pt-5">
              Restricted to {ALLOWED_DOMAIN} accounts.
            </p>
          )}
        </div>
      </main>

      <footer className="px-6 pb-10 sm:px-10">
        <p className="eyebrow text-ink-secondary">© Jinraj Joshipura 1994</p>
      </footer>
    </div>
  );
}
