import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canAnswerAssignment } from "@/lib/attempts/workable";
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

/** Student-facing wording: what state *their* work is in. */
const STATE_LABELS: Record<AttemptState, string> = {
  NOT_STARTED: "Not started",
  DRAFT: "In progress",
  SUBMITTED: "Submitted",
  REOPENED: "Reopened — submit again when you're ready",
  RESUBMITTED: "Resubmitted",
};

interface AttemptRow {
  assignment_id: string;
  state: AttemptState;
  reopened_at: string | null;
}

export default async function StudentAssignmentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // RLS scopes the assignment list to the student's own classes, so all
  // three reads are independent and batch into one round-trip.
  const [
    { data: profile, error: profileError },
    { data: assignments, error },
    { data: attempts, error: attemptsError },
  ] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase
      .from("assignments")
      .select("id, title, assignment_stage, status, open_at, close_at, classes(name)")
      .order("status", { ascending: true })
      .order("close_at", { ascending: true, nullsFirst: false })
      .returns<AssignmentRow[]>(),
    supabase
      .from("assignment_attempts")
      .select("assignment_id, state, reopened_at")
      .eq("student_id", user.id)
      .returns<AttemptRow[]>(),
  ]);

  if (profileError) throw new Error(`Failed to load your profile: ${profileError.message}`);
  if (profile?.role !== "STUDENT") redirect("/classes");
  if (error) throw new Error(`Failed to load assignments: ${error.message}`);
  if (attemptsError) throw new Error(`Failed to load attempts: ${attemptsError.message}`);

  const attemptByAssignment = new Map<string, AttemptRow>(
    (attempts ?? []).map((a) => [a.assignment_id, a])
  );

  return (
    <main className="page-standard">
      <h1 className="title-md">Your assignments</h1>

      {!assignments || assignments.length === 0 ? (
        <p className="banner mt-6">
          Nothing to do right now. Assignments appear here once your professor
          opens them.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {assignments.map((a) => {
            const attempt = attemptByAssignment.get(a.id);
            const state = attempt?.state ?? "NOT_STARTED";
            const finished = state === "SUBMITTED" || state === "RESUBMITTED";
            const open = a.status === "OPEN";
            const answerable = canAnswerAssignment(
              a.status,
              attempt ? { state: attempt.state, reopenedAt: attempt.reopened_at } : null
            );
            const href = finished
              ? `/assignments/${a.id}/receipt`
              : answerable
                ? `/assignments/${a.id}`
                : null;
            return (
              <li key={a.id} className="card-standard">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">{a.title}</p>
                    <p className="note mt-0.5">
                      {a.classes?.name}
                      {a.close_at && open && (
                        <> · closes {new Date(a.close_at).toLocaleString()}</>
                      )}
                      {!open && (
                        <>
                          {" "}
                          · closed{answerable && " to the class, reopened for you"}
                        </>
                      )}
                    </p>
                    <p className="note-muted mt-1">{STATE_LABELS[state]}</p>
                  </div>
                  {href ? (
                    <Link
                      href={href}
                      className={`btn ${finished ? "btn-secondary" : "btn-primary"}`}
                    >
                      {finished
                        ? "View receipt"
                        : state === "NOT_STARTED"
                          ? "Start"
                          : state === "REOPENED"
                            ? "Answer again"
                            : "Continue"}
                    </Link>
                  ) : (
                    <span className="badge">Closed</span>
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
