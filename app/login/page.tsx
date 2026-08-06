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
 * The masthead is transparent here, so the backdrop shows through behind
 * the wordmark; the footer line takes an explicit secondary ink because
 * the muted default is only 3.88:1 on that backdrop.
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
      <header className="masthead flex items-baseline gap-3 px-6 py-5 sm:px-10">
        <span className="wordmark text-lg">EVALUATING ENERGY SOURCES</span>
      </header>

      <main className="flex flex-1 items-center px-6 py-16 sm:px-10">
        <div className="card-elevated w-full max-w-xl">
          <p className="eyebrow">Sign in</p>

          {/* The headline is the one centred element on this card: it is long
              enough to wrap at every width, and `text-center` (not just a
              centred block) is what keeps the wrapped lines centred against
              each other. `mx-auto` centres the measure itself, so the optical
              centre is the card's and not the left edge of a left-hung box.
              28ch clears the balanced two-line break on desktop (widest line
              426px) while staying inside the card's 512px content width.

              `break-words` is the 320px safety net: FUTURETECTURE is 237px
              set at 30px caps and the card's content box is only 208px there,
              so without it the word runs past the padding. It is a
              last-resort rule, so it costs nothing at 375px and up — measured
              identical line counts and break points with and without.
              `hyphens-auto` would be the prettier break but Chromium ships no
              hyphenation dictionary for it here, so it is a no-op. */}
          <h1 className="title-lg mx-auto mt-4 max-w-[28ch] text-balance break-words text-center">
            FUTURETECTURE EVALUATING ENERGY SOURCES
          </h1>

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
