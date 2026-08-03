"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  BookOpen,
  ClipboardList,
  GraduationCap,
  LogOut,
  ScrollText,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { roleLabel } from "@/lib/ui/labels";
import { avatarToneClass, initialsFrom } from "@/lib/ui/avatar-tone";

export interface ShellUser {
  fullName: string | null;
  email: string;
  role: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/** Navigation is role-derived: nobody is shown a door they can't open. */
function navFor(role: string): NavItem[] {
  if (role === "STUDENT") {
    return [{ href: "/assignments", label: "Your assignments", icon: ClipboardList }];
  }
  if (role === "ADMIN") {
    return [
      { href: "/admin/users", label: "People", icon: Users },
      { href: "/admin/audit", label: "Activity log", icon: ScrollText },
      { href: "/classes", label: "Classes", icon: BookOpen },
    ];
  }
  return [{ href: "/classes", label: "Your classes", icon: BookOpen }];
}

/**
 * The global shell.
 *
 * COMPOSITION (the "Meridian" direction, see app/globals.css): a peach
 * backdrop on <html>, a floating white app frame, a dark navy icon-only
 * rail down its left edge, and the page canvas beside it.
 *
 * WHY THIS NO LONGER USES components/ui/sidebar: that component positions
 * its rail `fixed inset-y-0 left-0`, i.e. pinned to the VIEWPORT. Inside a
 * frame that is inset from the viewport by a margin, a viewport-pinned rail
 * lands outside the frame it is supposed to sit in. It also animates its
 * own width when it collapses, which the motion budget forbids (colour,
 * opacity and shadow only — never size or position), and its cva reaches
 * for Tailwind v4 bare-data syntax (`data-active:bg-sidebar-accent`) that
 * v3 silently drops, so its active state never rendered here in the first
 * place. A static flex column is the whole component this shell needs.
 *
 * The nav is icon-only by design, never by omission: every item still
 * ships its label in the DOM as the link's accessible name AND as a
 * hover/focus tooltip, and the active item is marked with aria-current.
 * Nothing here is reachable by sight alone.
 */
export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const items = navFor(user.role);
  const displayName = user.fullName ?? user.email;

  async function signOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="app-frame">
      {/* ---------------- the navy rail ---------------- */}
      <nav
        aria-label="Main"
        className="rail flex w-16 shrink-0 flex-col items-center gap-1 py-4"
      >
        {/* The logo tile wears the active-indicator orange permanently.
            It needs `hover:` variants on BOTH colour properties, not just
            the background: `.rail-item:hover` in the components layer
            flips the ink to white, and white on this orange is 2.93:1.
            Matching that hover specificity from the utilities layer is
            what holds the tile at its measured 5.50:1. */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              href="/"
              aria-label="EVALUATING ENERGY SOURCES — home"
              className="rail-item mb-4 size-10 bg-rail-active text-rail-active-ink hover:bg-rail-active hover:text-rail-active-ink"
            >
              <GraduationCap className="size-5" aria-hidden="true" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right">Home</TooltipContent>
        </Tooltip>

        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  data-active={active}
                  aria-current={active ? "page" : undefined}
                  className="rail-item size-10"
                >
                  <item.icon className="size-5" aria-hidden="true" />
                  <span className="sr-only">{item.label}</span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">{item.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </nav>

      {/* ---------------- the canvas ---------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The top bar is a quiet white strip inside the frame — the dark
            chrome bar of the previous direction moved into the rail. It
            carries the app's name, the shell-level copyright notice (one
            per authenticated screen, never duplicated per page) and the
            account menu, which is where the reference puts the avatar. */}
        <header className="masthead flex h-16 shrink-0 items-center gap-3 px-5">
          <span className="wordmark truncate text-sm">EVALUATING ENERGY SOURCES</span>

          {/* Rendered exactly once, at every width. A responsive pair of
              spans (`hidden sm:inline` + `sm:hidden`) would look identical
              on screen but put the string in the DOM TWICE, which is both
              a duplicate for screen readers and an assertion this shell's
              test makes directly. */}
          <span className="eyebrow ml-auto truncate">© JINRAJ JOSHIPURA 1994</span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="rounded-full"
                aria-label={`Account menu for ${displayName}`}
              >
                <Avatar className="size-9">
                  <AvatarFallback
                    className={`text-xs font-semibold ${avatarToneClass(user.email)}`}
                  >
                    {initialsFrom(user.fullName, user.email)}
                  </AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end" className="w-60">
              <DropdownMenuLabel className="font-normal">
                <p className="font-semibold">{user.fullName ?? "Signed in"}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
                <span className="badge badge-blue mt-2">{roleLabel(user.role)}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={signingOut} onSelect={() => void signOut()}>
                <LogOut className="size-4" aria-hidden="true" />
                {signingOut ? "Signing out…" : "Sign out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
