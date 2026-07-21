import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AttemptRunner, type TakingQuestion } from "@/components/attempts/attempt-runner";
import type { AttemptState, ResponseValue } from "@/lib/types/domain";

interface AttemptPayload {
  id: string;
  state: AttemptState;
}

export default async function TakeAssignmentPage({
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

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw new Error(`Failed to load your profile: ${profileError.message}`);
  if (profile?.role !== "STUDENT") redirect("/classes");

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id, title, instructions, status, allow_draft_editing")
    .eq("id", assignmentId)
    .maybeSingle();
  if (assignmentError) throw new Error(`Failed to load assignment: ${assignmentError.message}`);
  if (!assignment) notFound();
  if (assignment.status !== "OPEN") redirect(`/assignments/${assignmentId}/receipt`);

  const { data: attemptData, error: attemptError } = await supabase.rpc(
    "get_or_create_attempt",
    { p_assignment_id: assignmentId }
  );
  if (attemptError) throw new Error(`Could not open the assignment: ${attemptError.message}`);
  const attempt = attemptData as unknown as AttemptPayload;
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

  const savedValues = new Map<string, ResponseValue>(
    (responses ?? []).map((r) => [r.question_id, r.response_value as ResponseValue])
  );

  const takingQuestions: TakingQuestion[] = (questions ?? []).map((q) => ({
    id: q.id,
    externalQuestionCode: q.external_question_code,
    questionText: q.question_text,
    responseZeroLabel: q.response_zero_label,
    responseOneLabel: q.response_one_label,
    displayOrder: q.display_order,
  }));

  // Every question gets an entry (null = unanswered) so the local-draft
  // merge knows the full universe of valid question ids.
  const initialAnswers: Record<string, ResponseValue> = {};
  for (const q of takingQuestions) {
    initialAnswers[q.id] = savedValues.get(q.id) ?? null;
  }

  return (
    <main className="mx-auto max-w-2xl p-8">
      <AttemptRunner
        attemptId={attempt.id}
        assignmentTitle={assignment.title}
        instructions={assignment.instructions}
        questions={takingQuestions}
        initialAnswers={initialAnswers}
        reviewPath={`/assignments/${assignmentId}/review`}
        allowDraftEditing={assignment.allow_draft_editing}
      />
    </main>
  );
}
