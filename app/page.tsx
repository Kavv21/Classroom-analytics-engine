import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { roleLabel } from "@/lib/ui/labels";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: { full_name: string | null; email: string; role: string } | null = null;
  if (user) {
    const { data, error } = await supabase
      .from("profiles")
      .select("full_name, email, role")
      .eq("id", user.id)
      .maybeSingle();
    if (error) throw new Error(`Failed to load your profile: ${error.message}`);
    profile = data;
  }

  const destination =
    profile?.role === "STUDENT"
      ? { href: "/assignments", label: "Go to your assignments" }
      : { href: "/classes", label: "Go to your classes" };

  return (
    <main className="page-spacious">
      <h1 className="title-lg">Classroom Opinion Analytics</h1>
      <p className="lede mt-3">
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
    </main>
  );
}
