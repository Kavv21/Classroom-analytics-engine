import type { Metadata } from "next";
import "./globals.css";
import { createClient } from "@/lib/supabase/server";
import { AppShell, type ShellUser } from "@/components/shell/app-shell";
import { hasAnyTaMembership } from "@/lib/classes/access";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "EVALUATING ENERGY SOURCES",
  description: "Collects and analyses binary student opinions across paired assignments.",
};

/**
 * The global sidebar shell wraps every page for a provisioned user;
 * signed-out and not-yet-provisioned people (login, /not-provisioned) get
 * a bare page, since there is nothing for them to navigate to.
 *
 * Cost: one lightweight profile read per request. Middleware already
 * fetches the same row, but its result cannot cross into the render tree,
 * so this is a deliberate second read for identity. It is a single
 * indexed primary-key lookup.
 *
 * (History: this shell was briefly left unmounted because the Excel
 * export and admin links appeared unclickable under it. The real cause
 * was not layout instability — it was shadcn's sidebar CSS using Tailwind
 * v4 arbitrary-property syntax `w-(--sidebar-width)`, which Tailwind v3
 * silently drops, leaving the sidebar with no width so it overlaid the
 * page and intercepted pointer events. Fixed by converting that syntax to
 * v3 `w-[var(--sidebar-width)]` across components/ui — the same v4→v3
 * defect class already fixed twice in this project.)
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  let shellUser: ShellUser | null = null;
  if (user) {
    // TA-ness lives in class_members, not in profiles.role, so the shell
    // needs both reads to decide which doors to show. Two indexed lookups
    // in one round-trip.
    const [{ data }, assistsAClass] = await Promise.all([
      supabase
        .from("profiles")
        .select("full_name, email, role")
        .eq("id", user.id)
        .maybeSingle(),
      hasAnyTaMembership(user.id),
    ]);
    if (data) {
      shellUser = {
        fullName: data.full_name,
        email: data.email,
        role: data.role,
        assistsAClass,
      };
    }
  }

  return (
    <html lang="en">
      <body>
        <TooltipProvider delayDuration={200}>
          {shellUser ? <AppShell user={shellUser}>{children}</AppShell> : children}
        </TooltipProvider>
        {/* Toasts announce the outcome of an action in the same words as
            the control that caused it ("Publish" -> "Published"). */}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
