import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";

/**
 * The sign-in screen: the app's front door, and the only page most people
 * see before they are anyone in particular.
 *
 * It is deliberately not a card on a page. There is nothing else on this
 * screen to sit beside, so the content is centred in the viewport on the
 * warm page surface and given room — a bordered box would only draw a
 * frame around empty space.
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
    <main className="page-spacious flex min-h-screen flex-col items-center justify-center text-center">
      <h1 className="title-lg max-w-[14ch] text-balance">Evaluating Energy Sources</h1>

      <p className="lede mt-4 max-w-sm">
        Use your university Google account. If you&rsquo;re a student, your professor adds you to a
        class roster before your first sign-in.
      </p>

      <div className="mt-10">
        <GoogleSignInButton />
      </div>

      {ALLOWED_DOMAIN && (
        <p className="eyebrow mt-5">Restricted to {ALLOWED_DOMAIN} accounts</p>
      )}

      <p className="eyebrow mt-16">© Jinraj Joshipura 1994</p>
    </main>
  );
}
