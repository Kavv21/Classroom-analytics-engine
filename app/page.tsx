import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { roleLabel } from "@/lib/ui/labels";
import { hasAnyTaMembership } from "@/lib/classes/access";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: { full_name: string | null; email: string; role: string } | null = null;
  let assistsAClass = false;
  if (user) {
    const [{ data, error }, isTa] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, email, role")
        .eq("id", user.id)
        .maybeSingle(),
      hasAnyTaMembership(user.id),
    ]);
    if (error) throw new Error(`Failed to load your profile: ${error.message}`);
    profile = data;
    assistsAClass = isTa;
  }

  // A student who also assists a class still lands on their own
  // assignments — that is the obligation with a deadline. The classes they
  // assist are one click away in the rail.
  const destination =
    profile?.role === "STUDENT"
      ? { href: "/assignments", label: "Go to your assignments" }
      : {
          href: "/classes",
          label: assistsAClass && profile?.role === "TA"
            ? "Go to the classes you assist"
            : "Go to your classes",
        };

  return (
    <main>
      {/* The professor's two-line masthead treatment, identical to the one on
          /login (see `.brand-header` in globals.css). It sits outside the
          `page-spacious` measure rather than inside it: that column is capped
          at max-w-xl, which would hold line 1 ~4px short of the specified 48px
          forever, and a heading is allowed to be wider than the reading
          measure it introduces. It replaces the old one-line
          "EVALUATING ENERGY SOURCES" h1, which said the same thing twice once
          this went above it; the app's name is unchanged everywhere else.

          Second line reads "Resources", not "Sources" — the professor's
          wording for this heading specifically, not a typo to correct. */}
      <header className="brand-header px-6 pt-16 sm:px-8">
        <h1 className="brand-display" aria-label="FUTURETECTURE">
          FUTURETECTURE
        </h1>
        <p className="brand-statement mt-3">Evaluating Energy Resources</p>
      </header>

      <div className="page-spacious pt-10">
        <p className="lede">
          Collects student opinions across two assignments and shows how they
          shifted between them.
        </p>

        {profile ? (
          <>
            <div className="card-spacious mt-8 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium">{profile.full_name ?? profile.email}</p>
                <p className="note-muted mt-0.5">{roleLabel(profile.role)}</p>
              </div>
              <SignOutButton />
            </div>
            <div className="mt-6">
              <Link href={destination.href} className="btn btn-primary">
                {destination.label}
              </Link>
            </div>
          </>
        ) : (
          <div className="mt-8">
            <Link href="/login" className="btn btn-primary">
              Sign in
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
