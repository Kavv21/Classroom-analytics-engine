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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { roleLabel } from "@/lib/ui/labels";

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

function initials(user: ShellUser): string {
  const source = user.fullName?.trim() || user.email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const items = navFor(user.role);

  async function signOut() {
    setSigningOut(true);
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <Link href="/" className="flex items-center gap-2 px-2 py-1.5">
            <GraduationCap className="size-5 shrink-0" aria-hidden="true" />
            <span className="truncate font-semibold group-data-[collapsible=icon]:hidden">
              EVALUATING ENERGY SOURCES
            </span>
          </Link>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Navigation</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => {
                  const active =
                    pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                        <Link href={item.href}>
                          <item.icon className="size-4" aria-hidden="true" />
                          <span>{item.label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton
                    size="lg"
                    aria-label={`Account menu for ${user.fullName ?? user.email}`}
                  >
                    <Avatar className="size-7">
                      <AvatarFallback>{initials(user)}</AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left leading-tight">
                      <span className="truncate font-medium">
                        {user.fullName ?? user.email}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {roleLabel(user.role)}
                      </span>
                    </div>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="start" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <p className="font-medium">{user.fullName ?? "Signed in"}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem disabled={signingOut} onSelect={() => void signOut()}>
                    <LogOut className="size-4" aria-hidden="true" />
                    {signingOut ? "Signing out…" : "Sign out"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          {/* One shell-level notice rather than a per-page footer, so it is
              present on every authenticated screen and never duplicated. */}
          <span className="eyebrow ml-auto whitespace-nowrap">
            © JINRAJ JOSHIPURA 1994
          </span>
        </header>
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
