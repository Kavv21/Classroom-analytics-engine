import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CsvAnswerUpload } from "@/components/attempts/csv-answer-upload";
import type { CsvQuestion } from "@/lib/attempts/commit-csv-submission";
import type { AttemptState } from "@/lib/types/domain";

interface AttemptPayload {
  id: string;
  state: AttemptState;
}

/**
 * The student's answering route. CSV upload is the primary path: download a
 * sheet, fill it in, upload it, check the preview, confirm.
 *
 * The per-question UI still exists at ./questions and is linked from here.
 * It was NOT removed, and that is a deliberate call worth stating: it owns
 * the debounced draft autosave, the offline retry queue and the local-draft
 * recovery that a single-shot upload has no equivalent for, and the
 * zero-tolerance no-auto-submit guarantees are asserted against it by
 * tests/unit/no-auto-submit.test.tsx. Deleting it would have dropped tested
 * protections rather than replaced them. Both routes write to the same
 * attempt through the same RPCs.
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

  const [
    { data: profile, error: profileError },
    { data: assignment, error: assignmentError },
    { data: questions, error: questionsError },
  ] = await Promise.all([
    supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
    supabase
      .from("assignments")
      .select("id, title, instructions, status")
      .eq("id", assignmentId)
      .maybeSingle(),
    supabase
      .from("questions")
      .select("id, external_question_code, question_text, display_order")
      .eq("assignment_id", assignmentId)
      .eq("is_active", true)
      .order("display_order", { ascending: true }),
  ]);

  if (profileError) throw new Error(`Failed to load your profile: ${profileError.message}`);
  if (profile?.role !== "STUDENT") redirect("/classes");
  if (assignmentError) throw new Error(`Failed to load assignment: ${assignmentError.message}`);
  if (!assignment) notFound();
  if (assignment.status !== "OPEN") redirect(`/assignments/${assignmentId}/receipt`);
  if (questionsError) throw new Error(`Failed to load questions: ${questionsError.message}`);

  const { data: attemptData, error: attemptError } = await supabase.rpc(
    "get_or_create_attempt",
    { p_assignment_id: assignmentId }
  );
  if (attemptError) throw new Error(`Could not open the assignment: ${attemptError.message}`);
  const attempt = attemptData as unknown as AttemptPayload;
  if (attempt.state === "SUBMITTED" || attempt.state === "RESUBMITTED") {
    redirect(`/assignments/${assignmentId}/receipt`);
  }

  const csvQuestions: CsvQuestion[] = (questions ?? []).map((q) => ({
    id: q.id,
    externalQuestionCode: q.external_question_code,
    questionText: q.question_text,
    displayOrder: q.display_order,
  }));

  return (
    <main className="page-dense-narrow max-w-2xl">
      <CsvAnswerUpload
        attemptId={attempt.id}
        assignmentTitle={assignment.title}
        instructions={assignment.instructions}
        questions={csvQuestions}
        receiptPath={`/assignments/${assignmentId}/receipt`}
        manualPath={`/assignments/${assignmentId}/questions`}
      />
    </main>
  );
}
