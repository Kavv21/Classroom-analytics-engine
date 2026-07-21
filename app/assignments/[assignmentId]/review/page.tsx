import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SubmitAttemptButton } from "@/components/attempts/submit-attempt-button";
import type { ResponseValue } from "@/lib/types/domain";

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

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id, title, status")
    .eq("id", assignmentId)
    .maybeSingle();
  if (assignmentError) throw new Error(`Failed to load assignment: ${assignmentError.message}`);
  if (!assignment) notFound();

  const { data: attempt, error: attemptError } = await supabase
    .from("assignment_attempts")
    .select("id, state")
    .eq("assignment_id", assignmentId)
    .eq("student_id", user.id)
    .maybeSingle();
  if (attemptError) throw new Error(`Failed to load your attempt: ${attemptError.message}`);
  if (!attempt) redirect(`/assignments/${assignmentId}`);
  if (attempt.state === "SUBMITTED" || attempt.state === "RESUBMITTED") {
    redirect(`/assignments/${assignmentId}/receipt`);
  }

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select(
      "id, external_question_code, question_text, response_zero_label, response_one_label, display_order"
    )
    .eq("assignment_id", assignmentId)
    .eq("is_active", true)
    .order("display_order", { ascending: true });
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
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-bold">Review your answers</h1>
      <p className="mt-1 text-sm text-gray-600">{assignment.title}</p>

      {assignment.status !== "OPEN" && (
        <p role="alert" className="mt-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          This assignment is no longer open — submission is not possible.
        </p>
      )}

      {unanswered.length > 0 && (
        <p className="mt-4 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {unanswered.length} question{unanswered.length === 1 ? " is" : "s are"} unanswered:{" "}
          {unanswered.map((q) => q.external_question_code).join(", ")}
        </p>
      )}

      <ul className="mt-6 divide-y divide-gray-100 rounded border border-gray-200">
        {(questions ?? []).map((q, i) => {
          const value = values.get(q.id) ?? null;
          const label =
            value === 0 ? q.response_zero_label : value === 1 ? q.response_one_label : null;
          return (
            <li key={q.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div>
                <p className="text-sm text-gray-500">
                  {i + 1}. <span className="font-mono text-xs">{q.external_question_code}</span>
                </p>
                <p className="text-sm">{q.question_text}</p>
              </div>
              {value === null ? (
                <span className="shrink-0 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                  Unanswered
                </span>
              ) : (
                <span className="shrink-0 rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                  {value} — {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex items-center gap-4">
        {assignment.status === "OPEN" && (
          <SubmitAttemptButton
            attemptId={attempt.id}
            receiptPath={`/assignments/${assignmentId}/receipt`}
            unansweredCount={unanswered.length}
          />
        )}
        <Link
          href={`/assignments/${assignmentId}`}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Back to questions
        </Link>
      </div>
    </main>
  );
}
