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

  return (
    <main className="mx-auto max-w-xl p-8">
      <div className="rounded border border-green-200 bg-green-50 p-6 text-center">
        <p className="text-3xl">✓</p>
        <h1 className="mt-2 text-xl font-bold text-green-900">
          {attempt.state === "RESUBMITTED" ? "Resubmitted" : "Submitted"}
        </h1>
        <p className="mt-1 text-sm text-green-800">{assignment.title}</p>
      </div>

      <dl className="mt-6 space-y-2 rounded border border-gray-200 p-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500">Submitted at</dt>
          <dd>{attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString() : "—"}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Questions answered</dt>
          <dd>
            {answered ?? 0} of {total ?? 0}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Submission version</dt>
          <dd>{attempt.submission_version}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Receipt reference</dt>
          <dd className="font-mono text-xs">{attempt.id}</dd>
        </div>
      </dl>

      <p className="mt-4 text-sm text-gray-600">
        Your answers are recorded. If anything needs changing, ask your professor to reopen
        the attempt.
      </p>

      <div className="mt-6">
        <Link
          href="/assignments"
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Back to assignments
        </Link>
      </div>
    </main>
  );
}
