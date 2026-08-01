import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

/**
 * The sign-in screen: the app's front door, and the only page most people
 * see before they are anyone in particular.
 *
 * The content sits in a centred, lifted card on the slate page surface —
 * the entry-screen shape taken from the 21st.dev "Login Page 1" pull and
 * rebuilt on project tokens. (It was previously deliberately card-less; the
 * new direction carries hierarchy with elevation rather than with paper
 * warmth, so on a bare page this screen had nothing left to sit on.)
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
    <main className="page-spacious flex min-h-screen flex-col items-center justify-center">
      <div className="card-elevated w-full max-w-md text-center">
        <h1 className="title-lg mx-auto max-w-[14ch] text-balance">
          Evaluating Energy Sources
        </h1>

        <p className="lede mx-auto mt-4 max-w-sm">
          Use your university Google account. If you&rsquo;re a student, your professor adds you to
          a class roster before your first sign-in.
        </p>

        <div className="mt-10">
          <GoogleSignInButton />
        </div>

        {ALLOWED_DOMAIN && (
          <p className="eyebrow mt-5">Restricted to {ALLOWED_DOMAIN} accounts</p>
        )}
      </div>

      <p className="eyebrow mt-10">© Jinraj Joshipura 1994</p>
    </main>
  );
}
