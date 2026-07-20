import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isUnauthenticatedPath, isUnprovisionedPath } from "@/lib/auth/public-paths";

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * Enforces the actual access boundary for this app: a session alone
 * (proof of *who* someone is, via Google) is not enough — they also need
 * a `profiles` row, created by handle_new_user() only when their email
 * matched app_config.allowed_email_domain AND a roster_entries row
 * existed for them at first sign-in. See docs/AUTH_SSO.md.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user) {
    if (isUnauthenticatedPath(pathname)) return response;
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Session exists — but only a `profiles` row means handle_new_user()
  // actually provisioned this account. RLS (profiles_select_own) permits
  // this: id = auth.uid().
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", user.id)
    .maybeSingle();

  // A query error (e.g. missing GRANT, connection failure) is not the same
  // thing as "no profile row" — conflating them sends fully provisioned
  // users to /not-provisioned with no signal that anything is actually
  // broken. Fail loudly instead of guessing.
  if (profileError) {
    console.error("middleware: profile lookup failed", profileError);
    return new NextResponse("Internal error checking account status.", { status: 500 });
  }

  if (!profile) {
    if (isUnprovisionedPath(pathname)) return response;
    return NextResponse.redirect(new URL("/not-provisioned", request.url));
  }

  if (isUnauthenticatedPath(pathname) || isUnprovisionedPath(pathname)) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
