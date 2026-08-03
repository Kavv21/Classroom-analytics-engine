"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MoreHorizontal, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { changeUserRole, inviteStaff, setUserActive } from "@/lib/admin/actions";
import { roleLabel } from "@/lib/ui/labels";
import { PILL } from "@/lib/ui/tone";
import { PersonChip } from "@/components/ui/person-avatar";
import type { UserRole } from "@/lib/types/domain";

export interface AdminUserRow {
  id: string;
  email: string;
  fullName: string | null;
  role: string;
  rollNumber: string | null;
  programme: string | null;
  isActive: boolean;
  classes: string[];
}

/** A role is chrome, not a judgement — three hues to tell them apart. */
const ROLE_TONE: Record<string, string> = {
  ADMIN: PILL.purple,
  PROFESSOR: PILL.blue,
  STUDENT: PILL.slate,
};

export function UserTable({ rows }: { rows: AdminUserRow[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"ALL" | UserRole>("ALL");
  const [deactivating, setDeactivating] = useState<AdminUserRow | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<"PROFESSOR" | "ADMIN">("PROFESSOR");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter((r) => (roleFilter === "ALL" ? true : r.role === roleFilter))
      .filter((r) =>
        needle
          ? r.email.toLowerCase().includes(needle) ||
            (r.fullName ?? "").toLowerCase().includes(needle) ||
            (r.rollNumber ?? "").toLowerCase().includes(needle)
          : true
      );
  }, [rows, search, roleFilter]);

  const counts = useMemo(
    () => ({
      ALL: rows.length,
      ADMIN: rows.filter((r) => r.role === "ADMIN").length,
      PROFESSOR: rows.filter((r) => r.role === "PROFESSOR").length,
      STUDENT: rows.filter((r) => r.role === "STUDENT").length,
    }),
    [rows]
  );

  function onRoleChange(row: AdminUserRow, next: UserRole) {
    startTransition(async () => {
      const result = await changeUserRole(row.id, next);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${row.fullName ?? row.email} is now a ${roleLabel(next).toLowerCase()}.`);
      router.refresh();
    });
  }

  function onActiveChange(row: AdminUserRow, isActive: boolean) {
    startTransition(async () => {
      const result = await setUserActive(row.id, isActive);
      setDeactivating(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(
        isActive
          ? `${row.fullName ?? row.email} reactivated.`
          : `${row.fullName ?? row.email} deactivated.`
      );
      router.refresh();
    });
  }

  function onInvite() {
    startTransition(async () => {
      const result = await inviteStaff(inviteEmail, inviteRole, inviteName);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setInviteOpen(false);
      setInviteEmail("");
      setInviteName("");
      toast.success(
        result.data.mode === "promoted"
          ? `Existing account promoted to ${roleLabel(inviteRole).toLowerCase()}.`
          : `${inviteEmail} pre-authorised. They'll get access when they first sign in with Google.`
      );
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>People ({rows.length})</CardTitle>
            <CardDescription>
              Everyone with an account. Students appear here after their first
              sign-in.
            </CardDescription>
          </div>

          <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
            <DialogTrigger asChild>
              <Button>
                <UserPlus className="size-4" />
                Add professor or admin
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add a professor or administrator</DialogTitle>
                <DialogDescription>
                  Accounts are created by Google sign-in, so this pre-authorises
                  an email address. The next time they sign in they&rsquo;ll get
                  the role you choose. If they already have an account, it will
                  be promoted immediately.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 py-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="invite-email">University email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="name@university.edu"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="invite-name">Full name (optional)</Label>
                  <Input
                    id="invite-name"
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="invite-role">Role</Label>
                  <Select
                    value={inviteRole}
                    onValueChange={(v) => setInviteRole(v as "PROFESSOR" | "ADMIN")}
                  >
                    <SelectTrigger id="invite-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PROFESSOR">Professor</SelectItem>
                      <SelectItem value="ADMIN">Administrator</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setInviteOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={onInvite} disabled={pending || inviteEmail.trim() === ""}>
                  {pending ? "Adding…" : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs value={roleFilter} onValueChange={(v) => setRoleFilter(v as typeof roleFilter)}>
            <TabsList>
              <TabsTrigger value="ALL">All ({counts.ALL})</TabsTrigger>
              <TabsTrigger value="ADMIN">Admins ({counts.ADMIN})</TabsTrigger>
              <TabsTrigger value="PROFESSOR">Professors ({counts.PROFESSOR})</TabsTrigger>
              <TabsTrigger value="STUDENT">Students ({counts.STUDENT})</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="relative">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, roll number…"
              aria-label="Search people"
              className="w-64 pl-8"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Classes</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <PersonChip
                      fullName={row.fullName}
                      email={row.email}
                      secondary={row.rollNumber}
                    />
                  </TableCell>
                  <TableCell className="text-ink-secondary">{row.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={ROLE_TONE[row.role] ?? ""}>
                      {roleLabel(row.role)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {/* Text, not colour alone, carries the state. */}
                    <Badge
                      variant="outline"
                      className={row.isActive ? PILL.green : PILL.slate}
                    >
                      {row.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {row.classes.length === 0 ? "—" : row.classes.join(", ")}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Actions for ${row.fullName ?? row.email}`}
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Change role</DropdownMenuLabel>
                        {(["ADMIN", "PROFESSOR", "STUDENT"] as UserRole[]).map((r) => (
                          <DropdownMenuItem
                            key={r}
                            disabled={pending || row.role === r}
                            onSelect={() => onRoleChange(row, r)}
                          >
                            {roleLabel(r)}
                            {row.role === r && " (current)"}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        {row.isActive ? (
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={pending}
                            onSelect={(e) => {
                              e.preventDefault();
                              setDeactivating(row);
                            }}
                          >
                            Deactivate account
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            disabled={pending}
                            onSelect={() => onActiveChange(row, true)}
                          >
                            Reactivate account
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-ink-muted">
                    Nobody matches that search.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <AlertDialog open={deactivating !== null} onOpenChange={(o) => !o && setDeactivating(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deactivate {deactivating?.fullName ?? deactivating?.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They won&rsquo;t be able to sign in, and they will be excluded from
              class analytics. Their existing answers are kept and nothing is
              deleted. You can reactivate them at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deactivating && onActiveChange(deactivating, false)}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
