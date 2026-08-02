import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AnswerGrid } from "@/components/attempts/answer-grid";
import { buildAnswerGrid, type AnswerGridQuestion } from "@/lib/attempts/answer-grid";
import type { AttemptState, ResponseValue } from "@/lib/types/domain";

interface AttemptPayload {
  id: string;
  state: AttemptState;
}

/**
 * The student's answering route — the only one.
 *
 * It renders the source spreadsheet's own grid with every cell editable:
 * same rows, same columns, same order as the file the professor uploaded.
 * Two earlier routes were replaced by it and are gone: the
 * one-question-at-a-time runner (./questions) and the CSV
 * download/upload/preview wizard that used to live here. Students no longer
 * leave the browser to answer, and there is no file to lose track of.
 *
 * The layout is built server-side from the questions' stored source-cell
 * references, through the same `detectOrientation` / `buildGridMatrix` the
 * professor's response grid uses (lib/attempts/answer-grid.ts). The two
 * screens therefore cannot drift into showing different geometries for the
 * same assignment.
 */
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

  // Profile, assignment and questions depend only on user.id / the route
  // param, so they share one round-trip. The questions list is the largest
  // read on the page (255 rows for Assignment 2) and starts here rather
  // than waiting on the attempt.
  const [
    { data: profile, error: profileError },
    { data: assignment, error: assignmentError },
    { data: questions, error: questionsError },
  ] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase
      .from("assignments")
      .select("id, title, instructions, status, allow_draft_editing")
      .eq("id", assignmentId)
      .maybeSingle(),
    supabase
      .from("questions")
      // The two source-cell references are what place a question on the
      // grid; energy_source/criterion label its row and column.
      .select(
        "id, external_question_code, question_text, energy_source, criterion, original_row_reference, original_column_reference, response_zero_label, response_one_label, display_order"
      )
      .eq("assignment_id", assignmentId)
      .eq("is_active", true)
      .order("display_order", { ascending: true })
      .returns<AnswerGridQuestion[]>(),
  ]);

  if (profileError) throw new Error(`Failed to load your profile: ${profileError.message}`);
  if (profile?.role !== "STUDENT") redirect("/classes");
  if (assignmentError) throw new Error(`Failed to load assignment: ${assignmentError.message}`);
  if (!assignment) notFound();
  if (assignment.status !== "OPEN") redirect(`/assignments/${assignmentId}/receipt`);
  if (questionsError) throw new Error(`Failed to load questions: ${questionsError.message}`);

  // The attempt must not be created until the assignment is known to be
  // OPEN, and saved answers are keyed by the attempt id, so these stay
  // sequential by necessity.
  const { data: attemptData, error: attemptError } = await supabase.rpc("get_or_create_attempt", {
    p_assignment_id: assignmentId,
  });
  if (attemptError) throw new Error(`Could not open the assignment: ${attemptError.message}`);
  const attempt = attemptData as unknown as AttemptPayload;
  if (attempt.state === "SUBMITTED" || attempt.state === "RESUBMITTED") {
    redirect(`/assignments/${assignmentId}/receipt`);
  }

  const { data: responses, error: responsesError } = await supabase
    .from("responses")
    .select("question_id, response_value")
    .eq("attempt_id", attempt.id);
  if (responsesError) throw new Error(`Failed to load saved answers: ${responsesError.message}`);

  const savedValues = new Map<string, ResponseValue>(
    (responses ?? []).map((r) => [r.question_id, r.response_value as ResponseValue])
  );

  // Every question gets an entry (null = unanswered) so the local-draft
  // merge knows the full universe of valid question ids.
  const initialAnswers: Record<string, ResponseValue> = {};
  for (const q of questions ?? []) {
    initialAnswers[q.id] = savedValues.get(q.id) ?? null;
  }

  return (
    <main className="page-dense-narrow">
      <AnswerGrid
        attemptId={attempt.id}
        assignmentTitle={assignment.title}
        instructions={assignment.instructions}
        layout={buildAnswerGrid(questions ?? [])}
        initialAnswers={initialAnswers}
        receiptPath={`/assignments/${assignmentId}/receipt`}
        allowDraftEditing={assignment.allow_draft_editing}
      />
    </main>
  );
}
