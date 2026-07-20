"use client";

import { useState } from "react";
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
      setIsLoading(false);
    }
    // On success the browser navigates away to Google, so there is
    // nothing further to do here.
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleSignIn}
        disabled={isLoading}
        className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {isLoading ? "Redirecting…" : "Sign in with Google"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
