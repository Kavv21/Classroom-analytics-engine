import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Exchanges the OAuth `code` Google/Supabase redirected back with for a
 * session, then sends the browser to the homepage. Domain/roster
 * provisioning enforcement does not happen here — it happens in
 * middleware.ts on the next request, against the `profiles` table.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}/`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
