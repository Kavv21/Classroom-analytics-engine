import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

/**
 * The sign-in screen: the app's front door, and the only page most people
 * see before they are anyone in particular.
 *
 * This is screen 1a of the Ashfield design import ("Ashfield Sepia
 * System.dc.html"), rebuilt on project tokens. The source's composition is
 * a dark-ink masthead over a left-weighted plate: a framed leaf of paper
 * carrying a small-caps eyebrow, a large serif headline, a short lede, the
 * action, and a hairline-separated line of fine print. That structure came
 * across whole. What did not is the source's right-hand column — a
 * photographic etching captioned as an item from a named university
 * archive. It is mockup fiction: there is no such plate and no such
 * archive, so rather than invent one the column is left as paper.
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

          <h1 className="title-lg mt-4 max-w-[18ch] text-balance">
            Evaluating Energy Sources
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
        <p className="eyebrow">© Jinraj Joshipura 1994</p>
      </footer>
    </div>
  );
}
