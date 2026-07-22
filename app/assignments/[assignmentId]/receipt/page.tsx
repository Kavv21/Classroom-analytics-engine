import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function SubmissionReceiptPage({
  params,
}: {
  params: Promise<{ assignmentId: string }>;
}) {
  const { assignmentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id, title, status")
    .eq("id", assignmentId)
    .maybeSingle();
  if (assignmentError) throw new Error(`Failed to load assignment: ${assignmentError.message}`);
  if (!assignment) notFound();

  const { data: attempt, error: attemptError } = await supabase
    .from("assignment_attempts")
    .select("id, state, submitted_at, submission_version, reopened_at")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.id)
    .maybeSingle();
  if (attemptError) throw new Error(`Failed to load your attempt: ${attemptError.message}`);
  if (!attempt) redirect("/assignments");

  if (attempt.state !== "SUBMITTED" && attempt.state !== "RESUBMITTED") {
    // Not submitted (e.g. reopened, or still drafting): the receipt doesn't
    // exist yet — back to the assignment if it's still open.
    if (assignment.status === "OPEN") redirect(`/assignments/${assignmentId}`);
    redirect("/assignments");
  }

  const { count: answered, error: answeredError } = await supabase
    .from("responses")
    .select("id", { count: "exact", head: true })
    .eq("attempt_id", attempt.id)
    .not("response_value", "is", null);
  if (answeredError) throw new Error(`Failed to load answers: ${answeredError.message}`);

  const { count: total, error: totalError } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId)
    .eq("is_active", true);
  if (totalError) throw new Error(`Failed to load questions: ${totalError.message}`);

  const resubmitted = attempt.state === "RESUBMITTED";

  return (
    <main className="page-spacious">
      <div className="banner banner-good text-center">
        <p aria-hidden="true" className="text-2xl leading-none">
          ✓
        </p>
        <h1 className="title-md mt-2" style={{ color: "var(--status-good-text)" }}>
          {resubmitted ? "Resubmitted" : "Submitted"}
        </h1>
        <p className="mt-1 text-sm">{assignment.title}</p>
      </div>

      <dl className="card-spacious mt-6 space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-secondary">Submitted</dt>
          <dd>{attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString() : "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-secondary">Questions answered</dt>
          <dd>
            {answered ?? 0} of {total ?? 0}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-secondary">Submission</dt>
          <dd>
            {attempt.submission_version === 1
              ? "First submission"
              : `Version ${attempt.submission_version}`}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-secondary">Reference</dt>
          <dd className="mono">{attempt.id}</dd>
        </div>
      </dl>

      <p className="note mt-5">
        Your answers are recorded. If you need to change something, ask your
        professor to reopen this assignment for you.
      </p>

      <div className="mt-8">
        <Link href="/assignments" className="btn btn-secondary">
          Back to your assignments
        </Link>
      </div>
    </main>
  );
}
