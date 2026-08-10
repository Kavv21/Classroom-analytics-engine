"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { addClassTa, removeClassTa, type ClassTa } from "@/lib/classes/ta-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PILL } from "@/lib/ui/tone";
import { PersonChip } from "@/components/ui/person-avatar";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The class's teaching assistants — professor-only, and only ever rendered
 * for the professor (see app/classes/[classId]/page.tsx).
 *
 * That conditional is not what stops a TA managing TAs: `add_class_ta` and
 * `remove_class_ta` (migration 0028 §8) refuse anyone who is not the
 * class's professor or an admin, so a TA who reaches these actions by any
 * other route is refused by the database. This component exists because a
 * professor should not have to write SQL to add a colleague, not because
 * hiding it protects anything.
 */
export function ManageTas({ classId, tas }: { classId: string; tas: ClassTa[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [removing, setRemoving] = useState<ClassTa | null>(null);

  function onAdd() {
    startTransition(async () => {
      const result = await addClassTa(classId, email, fullName);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setEmail("");
      setFullName("");
      toast.success(
        result.data.mode === "ENROLLED"
          ? `${result.data.email} is now a teaching assistant for this class.`
          : `${result.data.email} is pre-authorised. They become a teaching assistant when they first sign in.`
      );
      router.refresh();
    });
  }

  function onRemove(ta: ClassTa) {
    startTransition(async () => {
      const result = await removeClassTa(classId, ta.email);
      setRemoving(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${ta.email} is no longer a teaching assistant for this class.`);
      router.refresh();
    });
  }

  return (
    <>
      <h2 className="title-sm mt-10">Teaching assistants</h2>
      <p className="note mt-1">
        A teaching assistant can do everything you can with this class&rsquo;s
        assignments, roster, responses and analytics. They cannot archive or
        delete the class, and they cannot add or remove other teaching
        assistants &mdash; only you can.
      </p>

      <div className="card-standard mt-4 flex flex-wrap items-end gap-3">
        <div className="grid min-w-56 flex-1 gap-1.5">
          <Label htmlFor="ta-email">University email</Label>
          <Input
            id="ta-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@university.edu"
          />
        </div>
        <div className="grid min-w-48 flex-1 gap-1.5">
          <Label htmlFor="ta-name">Full name (optional)</Label>
          <Input
            id="ta-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
        </div>
        <Button onClick={onAdd} disabled={pending || email.trim() === ""}>
          <UserPlus className="size-4" aria-hidden="true" />
          {pending ? "Adding…" : "Add assistant"}
        </Button>
      </div>

      {tas.length === 0 ? (
        <p className="note-muted mt-3">
          No teaching assistants for this class.
        </p>
      ) : (
        <div className="card-standard mt-4 overflow-x-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tas.map((ta) => (
                <TableRow key={ta.email}>
                  <TableCell>
                    <PersonChip fullName={ta.fullName} email={ta.email} />
                  </TableCell>
                  <TableCell className="text-ink-secondary">{ta.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={ta.status === "ACTIVE" ? PILL.green : PILL.slate}
                    >
                      {ta.status === "ACTIVE" ? "Active" : "Awaiting first sign-in"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => setRemoving(ta)}
                    >
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={removing !== null} onOpenChange={(o) => !o && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removing?.fullName ?? removing?.email} as a teaching assistant?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to this class immediately. Their account, and any
              other class they belong to, are unaffected. Nothing they did to
              this class is undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => removing && onRemove(removing)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
