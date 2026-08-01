"use client";

import { useState } from "react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

/**
 * `hd` only pre-filters Google's account picker — it is a UX hint, not a
 * security boundary. The real domain check happens server-side, in
 * handle_new_user() against app_config. See docs/AUTH_SSO.md section 1.
 */
const ALLOWED_DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN;

export function GoogleSignInButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignIn() {
    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: ALLOWED_DOMAIN ? { hd: ALLOWED_DOMAIN } : undefined,
      },
    });

    if (signInError) {
      setError(signInError.message);
      toast.error(signInError.message);
      setIsLoading(false);
    }
    // On success the browser navigates away to Google, so there is
    // nothing further to do here.
  }

  return (
    <div>
      {/* Light and bordered, not the app's ink primary. This is the one
          deliberate exception to that rule: Google's brand guidelines govern
          how a "Sign in with Google" button may look, and they ask for the
          full-colour G mark on a light surface. Restyling it to match our
          buttons would put us outside those terms. */}
      <button type="button" onClick={handleSignIn} disabled={isLoading} className="btn btn-secondary">
        <GoogleMark />
        {isLoading ? "Taking you to Google…" : "Sign in with Google"}
      </button>
      {error && (
        <p role="alert" className="banner banner-critical mt-3">
          We couldn&rsquo;t start the sign-in: {error} Please try again.
        </p>
      )}
    </div>
  );
}

/** Google's G mark, inlined — no external request, and it renders offline. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" className="h-4 w-4 shrink-0">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}
