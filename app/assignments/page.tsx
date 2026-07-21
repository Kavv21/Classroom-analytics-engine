import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { AttemptState } from "@/lib/types/domain";

interface AssignmentRow {
  id: string;
  title: string;
  assignment_stage: string;
  status: string;
  open_at: string | null;
  close_at: string | null;
  classes: { name: string } | null;
}

const STATE_LABELS: Record<AttemptState, string> = {
  NOT_STARTED: "Not started",
  DRAFT: "In progress",
  SUBMITTED: "Submitted",
  REOPENED: "Reopened — needs resubmission",
  RESUBMITTED: "Resubmitted",
};

export default async function StudentAssignmentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Failed to load your profile: ${profileError.message}`);
  if (profile?.role !== "STUDENT") redirect("/classes");

  // RLS (assignments_student_select) already scopes this to OPEN/CLOSED
  // assignments in the student's classes.
  const { data: assignments, error } = await supabase
    .from("assignments")
    .select("id, title, assignment_stage, status, open_at, close_at, classes(name)")
    .order("status", { ascending: true })
    .order("close_at", { ascending: true, nullsFirst: false })
    .returns<AssignmentRow[]>();
  if (error) throw new Error(`Failed to load assignments: ${error.message}`);

  const { data: attempts, error: attemptsError } = await supabase
    .from("assignment_attempts")
    .select("assignment_id, state")
    .eq("student_id", user.id);
  if (attemptsError) throw new Error(`Failed to load attempts: ${attemptsError.message}`);

  const attemptByAssignment = new Map<string, AttemptState>(
    (attempts ?? []).map((a) => [a.assignment_id, a.state as AttemptState])
  );

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Your assignments</h1>

      {!assignments || assignments.length === 0 ? (
        <p className="mt-6 text-gray-600">No assignments are available right now.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {assignments.map((a) => {
            const state = attemptByAssignment.get(a.id) ?? "NOT_STARTED";
            const finished = state === "SUBMITTED" || state === "RESUBMITTED";
            const open = a.status === "OPEN";
            const href = finished
              ? `/assignments/${a.id}/receipt`
              : open
                ? `/assignments/${a.id}`
                : null;
            return (
              <li key={a.id} className="rounded border border-gray-200 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium">{a.title}</p>
                    <p className="text-sm text-gray-600">
                      {a.classes?.name}
                      {a.close_at && open && (
                        <> · closes {new Date(a.close_at).toLocaleString()}</>
                      )}
                      {!open && <> · closed</>}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">{STATE_LABELS[state]}</p>
                  </div>
                  {href ? (
                    <Link
                      href={href}
                      className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      {finished ? "View receipt" : state === "NOT_STARTED" ? "Start" : "Continue"}
                    </Link>
                  ) : (
                    <span className="text-sm text-gray-400">Closed</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
