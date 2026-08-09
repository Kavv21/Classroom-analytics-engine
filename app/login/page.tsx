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
 * Note the second line reads "Resources", not the "Sources" of the app
 * name everywhere else. That is the professor's wording for this heading
 * specifically — it is not a typo to correct, and it does not rename
 * anything else (metadata title, rail wordmark, exports).
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
      {/* The masthead carries the brand statement, centred across the full page
          width, as the two-line display treatment (see `.brand-header` in
          globals.css for the sizing and why it is container-relative). It is
          the page's <h1> now: it is the largest, first, and most descriptive
          thing on the screen, so making the card's "Sign in" the h1 instead
          would put the document's outline out of order with what is on it.
          `aria-label` restates the word so no assistive tech has to infer it
          back out of the tracking — the text node is already the intact word,
          so the two can never disagree. */}
      <header className="masthead brand-header px-6 py-10 sm:px-10 sm:py-12">
        <h1 className="brand-display" aria-label="FUTURETECTURE">
          FUTURETECTURE
        </h1>
        <p className="brand-statement mt-3">Evaluating Energy Resources</p>
      </header>

      <main className="flex flex-1 items-center px-6 py-16 sm:px-10">
        <div className="card-elevated w-full max-w-xl">
          {/* The brand statement now lives in the masthead, so the card's own
              heading is just the task at hand. The "SIGN IN" eyebrow that used
              to sit above it is gone rather than kept: its job was to label a
              card whose headline was the product name, and once the headline
              *is* "Sign in" the two lines say the same word twice. It is an
              <h2> under the masthead h1 — same `title-sm` look, one rung down
              in the outline. */}
          <h2 className="title-sm">Sign in</h2>

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
