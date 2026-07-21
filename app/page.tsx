import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { SignOutButton } from "@/components/auth/sign-out-button";

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
      ? { href: "/assignments", label: "Your assignments" }
      : { href: "/classes", label: "Your classes" };

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Classroom Opinion Analytics Platform</h1>

      {profile ? (
        <>
          <div className="mt-6 flex items-center justify-between rounded border border-gray-200 p-4">
            <div>
              <p className="font-medium">{profile.full_name ?? profile.email}</p>
              <p className="text-sm text-gray-600">{profile.role}</p>
            </div>
            <SignOutButton />
          </div>
          <div className="mt-4">
            <Link
              href={destination.href}
              className="inline-block rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
            >
              {destination.label}
            </Link>
          </div>
        </>
      ) : (
        <div className="mt-6">
          <Link
            href="/login"
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
          >
            Sign in
          </Link>
        </div>
      )}
    </main>
  );
}
