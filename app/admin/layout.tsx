import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Separator } from "@/components/ui/separator";

/**
 * Admin console shell and guard.
 *
 * RLS is the real boundary (profiles_admin_all, audit_logs_admin, and the
 * admin SELECT policies added in migration 0016). This guard exists so a
 * non-admin gets a clean 404 instead of a page of empty tables, and so no
 * admin-only navigation is rendered for them at all.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  // A lookup failure is not the same as "not an admin" — surface it.
  if (error) {
    throw new Error(`Could not verify your access: ${error.message}`);
  }
  if (profile?.role !== "ADMIN") notFound();

  return (
    <div className="page-standard max-w-6xl">
      <header>
        <p className="note-muted">Administration</p>
        <h1 className="title-md mt-1">System administration</h1>
        <p className="note mt-1">
          Accounts and activity across every class. Class content itself is
          managed by each class&rsquo;s professor.
        </p>
      </header>

      <nav aria-label="Admin sections" className="mt-4 flex flex-wrap gap-2">
        <Link href="/admin/users" className="btn btn-sm btn-secondary">
          People
        </Link>
        <Link href="/admin/audit" className="btn btn-sm btn-secondary">
          Activity log
        </Link>
        <Link href="/" className="btn btn-sm btn-secondary">
          Back to app
        </Link>
      </nav>

      <Separator className="my-6" />
      {children}
    </div>
  );
}
