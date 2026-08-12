import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canAnswerAssignment } from "@/lib/attempts/workable";
import type { AttemptState } from "@/lib/types/domain";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LocalDateTime } from "@/components/ui/local-date-time";

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

  const [
    { data: assignment, error: assignmentError },
    { data: attempt, error: attemptError },
    { count: total, error: totalError },
  ] = await Promise.all([
    supabase
      .from("assignments")
      .select("id, title, status, open_at, close_at")
      .eq("id", assignmentId)
      .maybeSingle(),
    supabase
      .from("assignment_attempts")
      .select("id, state, submitted_at, submission_version, reopened_at")
      .eq("assignment_id", assignmentId)
      .eq("student_id", user.id)
      .maybeSingle(),
    supabase
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId)
      .eq("is_active", true),
  ]);

  if (assignmentError) throw new Error(`Failed to load assignment: ${assignmentError.message}`);
  if (!assignment) notFound();
  if (attemptError) throw new Error(`Failed to load your attempt: ${attemptError.message}`);
  if (!attempt) redirect("/assignments");
  if (totalError) throw new Error(`Failed to load questions: ${totalError.message}`);

  if (attempt.state !== "SUBMITTED" && attempt.state !== "RESUBMITTED") {
    // Not submitted (e.g. reopened, or still drafting): the receipt doesn't
    // exist yet — back to the assignment if they can still answer it. A
    // reopened attempt counts even on a CLOSED assignment; without that,
    // the two pages bounce a reopened student between each other and the
    // list, which is what "reopened but I can't get in" looked like.
    if (
      canAnswerAssignment(
        assignment.status,
        {
          state: attempt.state as AttemptState,
          reopenedAt: attempt.reopened_at,
        },
        { openAt: assignment.open_at, closeAt: assignment.close_at }
      )
    ) {
      redirect(`/assignments/${assignmentId}`);
    }
    redirect("/assignments");
  }

  // Only this one needs the attempt id, so it is the single second stage.
  const { count: answered, error: answeredError } = await supabase
    .from("responses")
    .select("id", { count: "exact", head: true })
    .eq("attempt_id", attempt.id)
    .not("response_value", "is", null);
  if (answeredError) throw new Error(`Failed to load answers: ${answeredError.message}`);

  const resubmitted = attempt.state === "RESUBMITTED";

  return (
    <main className="page-spacious">
      <div className="banner banner-good text-center">
        <p aria-hidden="true" className="text-2xl leading-none">
          ✓
        </p>
        <p className="eyebrow mt-2">{assignment.title}</p>
        <h1 className="title-md mt-1" style={{ color: "var(--status-good-text)" }}>
          {resubmitted ? "Resubmitted" : "Submitted"}
        </h1>
      </div>

      <Card className="mt-6 shadow-lifted"><CardContent><dl className="space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-secondary">Submitted</dt>
          <dd>
            <LocalDateTime value={attempt.submitted_at} />
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-secondary">Questions answered</dt>
          <dd>
            <Badge variant="outline" className="border-transparent bg-surface-sunken tabular-nums">
              {answered ?? 0} of {total ?? 0}
            </Badge>
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
      </dl></CardContent></Card>

      <p className="note mt-5">
        Your answers are recorded. If you need to change something, ask your
        professor to reopen this assignment for you.
      </p>

      <div className="mt-8">
        <Button asChild variant="outline">
          <Link href="/assignments">Back to your assignments</Link>
        </Button>
      </div>
    </main>
  );
}
