import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitAttemptButton } from "@/components/attempts/submit-attempt-button";
import type { ResponseValue } from "@/lib/types/domain";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { questionLabel, questionLabelWithCode } from "@/lib/ui/question-label";

export default async function ReviewAttemptPage({
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

  // Assignment, attempt, and questions all key off the route param and the
  // signed-in user, so they batch. Only the saved answers need the attempt
  // id, so they remain a second stage.
  const [
    { data: assignment, error: assignmentError },
    { data: attempt, error: attemptError },
    { data: questions, error: questionsError },
  ] = await Promise.all([
    supabase.from("assignments").select("id, title, status").eq("id", assignmentId).maybeSingle(),
    supabase
      .from("assignment_attempts")
      .select("id, state")
      .eq("assignment_id", assignmentId)
      .eq("student_id", user.id)
      .maybeSingle(),
    supabase
      .from("questions")
      .select(
        "id, external_question_code, question_text, response_zero_label, response_one_label, display_order"
      )
      .eq("assignment_id", assignmentId)
      .eq("is_active", true)
      .order("display_order", { ascending: true }),
  ]);

  if (assignmentError) throw new Error(`Failed to load assignment: ${assignmentError.message}`);
  if (!assignment) notFound();
  if (attemptError) throw new Error(`Failed to load your attempt: ${attemptError.message}`);
  if (!attempt) redirect(`/assignments/${assignmentId}`);
  if (attempt.state === "SUBMITTED" || attempt.state === "RESUBMITTED") {
    redirect(`/assignments/${assignmentId}/receipt`);
  }
  if (questionsError) throw new Error(`Failed to load questions: ${questionsError.message}`);

  const { data: responses, error: responsesError } = await supabase
    .from("responses")
    .select("question_id, response_value")
    .eq("attempt_id", attempt.id);
  if (responsesError) throw new Error(`Failed to load saved answers: ${responsesError.message}`);

  const values = new Map<string, ResponseValue>(
    (responses ?? []).map((r) => [r.question_id, r.response_value as ResponseValue])
  );
  const unanswered = (questions ?? []).filter((q) => (values.get(q.id) ?? null) === null);

  return (
    <main className="page-standard">
      <h1 className="title-md">Review your answers</h1>
      <p className="note mt-1">{assignment.title}</p>

      {assignment.status !== "OPEN" && (
        <Alert variant="destructive" className="mt-5">
          <AlertDescription>
            This assignment has closed, so you can no longer submit it. Talk to
            your professor if you still need to hand it in.
          </AlertDescription>
        </Alert>
      )}

      {unanswered.length > 0 && (
        <Alert className="mt-5"><AlertDescription>
          {unanswered.length} question{unanswered.length === 1 ? " is" : "s are"} still
          unanswered (
          {unanswered
            .map((q) =>
              questionLabelWithCode({
                questionText: q.question_text,
                code: q.external_question_code,
              })
            )
            .join("; ")}
          ). You
          can submit anyway — they&rsquo;ll be recorded as unanswered — or go back and
          fill them in.
        </AlertDescription></Alert>
      )}

      <Card className="mt-6 p-0"><CardContent className="p-0"><ul className="divide-y">
        {(questions ?? []).map((q, i) => {
          const value = values.get(q.id) ?? null;
          const label =
            value === 0 ? q.response_zero_label : value === 1 ? q.response_one_label : null;
          return (
            <li key={q.id} className="flex items-start justify-between gap-4 px-4 py-3">
              {/* The wording is what a student checks their answer against;
                  the number and code are the small supporting detail. */}
              <div className="min-w-0">
                <p className="text-sm">
                  {i + 1}. {questionLabel({ questionText: q.question_text, code: q.external_question_code })}
                </p>
                <p className="note-muted mt-0.5">
                  <span className="mono">{q.external_question_code}</span>
                </p>
              </div>
              {value === null ? (
                <Badge variant="outline" className="shrink-0 border-transparent bg-surface-warning text-[color:var(--status-warning-text)]">Unanswered</Badge>
              ) : (
                <Badge variant="outline" className="shrink-0 border-transparent bg-surface-sunken tabular-nums">
                  {value} — {label}
                </Badge>
              )}
            </li>
          );
        })}
      </ul></CardContent></Card>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {assignment.status === "OPEN" && (
          <SubmitAttemptButton
            attemptId={attempt.id}
            receiptPath={`/assignments/${assignmentId}/receipt`}
            unansweredCount={unanswered.length}
          />
        )}
        <Button asChild variant="outline">
          <Link href={`/assignments/${assignmentId}`}>Back to questions</Link>
        </Button>
      </div>
    </main>
  );
}
