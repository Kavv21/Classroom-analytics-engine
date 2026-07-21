import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatusActions } from "@/components/assignments/status-actions";
import {
  AttemptsTable,
  type AttemptTableRow,
} from "@/components/assignments/attempts-table";
import {
  QuestionManager,
  type QuestionRow,
} from "@/components/assignments/question-manager";
import type { AssignmentStatus } from "@/lib/types/domain";

interface ProgressRow {
  enrolled_students: number;
  draft_count: number;
  submitted_count: number;
  reopened_count: number;
  resubmitted_count: number;
  not_started_count: number;
}

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ classId: string; assignmentId: string }>;
}) {
  const { classId, assignmentId } = await params;
  const supabase = await createClient();

  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select(
      "id, class_id, title, description, instructions, assignment_stage, sequence_number, open_at, close_at, status, allow_draft_editing, allow_resubmission, response_zero_label, response_one_label"
    )
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .maybeSingle();

  if (assignmentError) {
    throw new Error(`Failed to load assignment: ${assignmentError.message}`);
  }
  if (!assignment) notFound();

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select(
      "id, external_question_code, question_text, energy_source, criterion, response_zero_label, response_one_label, display_order"
    )
    .eq("assignment_id", assignmentId)
    .order("display_order", { ascending: true })
    .returns<QuestionRow[]>();

  if (questionsError) {
    throw new Error(`Failed to load questions: ${questionsError.message}`);
  }

  const { count: responseCount, error: responseError } = await supabase
    .from("responses")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);

  if (responseError) {
    throw new Error(`Failed to check responses: ${responseError.message}`);
  }

  const { data: progress, error: progressError } = await supabase
    .from("assignment_submission_progress")
    .select(
      "enrolled_students, draft_count, submitted_count, reopened_count, resubmitted_count, not_started_count"
    )
    .eq("assignment_id", assignmentId)
    .maybeSingle<ProgressRow>();

  if (progressError) {
    throw new Error(`Failed to load submission progress: ${progressError.message}`);
  }

  const { data: attemptRows, error: attemptsError } = await supabase
    .from("assignment_attempts")
    .select(
      "id, state, submitted_at, reopened_at, submission_version, profiles!assignment_attempts_student_id_fkey(full_name, email)"
    )
    .eq("assignment_id", assignmentId)
    .order("submitted_at", { ascending: false, nullsFirst: false });

  if (attemptsError) {
    throw new Error(`Failed to load attempts: ${attemptsError.message}`);
  }

  const { data: imports, error: importsError } = await supabase
    .from("imports")
    .select("id, source_filename, status, created_at, summary")
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (importsError) {
    throw new Error(`Failed to load import history: ${importsError.message}`);
  }

  const status = assignment.status as AssignmentStatus;
  const hasResponses = (responseCount ?? 0) > 0;
  const editable = status === "DRAFT" || status === "READY";

  const attemptTableRows: AttemptTableRow[] = (
    (attemptRows ?? []) as unknown as Array<{
      id: string;
      state: string;
      submitted_at: string | null;
      reopened_at: string | null;
      submission_version: number;
      profiles: { full_name: string | null; email: string } | null;
    }>
  ).map((a) => ({
    id: a.id,
    state: a.state,
    submitted_at: a.submitted_at,
    reopened_at: a.reopened_at,
    submission_version: a.submission_version,
    studentName: a.profiles?.full_name ?? "—",
    studentEmail: a.profiles?.email ?? "—",
  }));

  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="text-sm text-gray-500">
        <Link href={`/classes/${classId}/assignments`} className="hover:underline">
          Assignments
        </Link>{" "}
        / #{assignment.sequence_number}
      </p>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">{assignment.title}</h1>
        <span className="rounded bg-gray-100 px-3 py-1 text-sm font-medium">{status}</span>
      </div>

      <div className="mt-2 flex gap-4 text-sm text-gray-600">
        <span>{assignment.assignment_stage.replaceAll("_", " ").toLowerCase()}</span>
        <span>
          answers: {assignment.response_zero_label} / {assignment.response_one_label}
        </span>
        {assignment.open_at && <span>opens {new Date(assignment.open_at).toLocaleString()}</span>}
        {assignment.close_at && <span>closes {new Date(assignment.close_at).toLocaleString()}</span>}
      </div>

      {assignment.description && <p className="mt-4 text-gray-700">{assignment.description}</p>}

      <div className="mt-6 flex gap-2">
        {editable && (
          <Link
            href={`/classes/${classId}/assignments/${assignmentId}/edit`}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Edit details
          </Link>
        )}
        {status === "DRAFT" && !hasResponses && (
          <Link
            href={`/classes/${classId}/assignments/${assignmentId}/import`}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
          >
            Import questions
          </Link>
        )}
      </div>

      <h2 className="mt-8 text-lg font-semibold">Status</h2>
      <div className="mt-3">
        <StatusActions
          assignmentId={assignmentId}
          classId={classId}
          status={status}
          questionCount={questions?.length ?? 0}
        />
      </div>

      {(status === "OPEN" || status === "CLOSED" || hasResponses) && progress && (
        <>
          <h2 className="mt-8 text-lg font-semibold">Submission progress</h2>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {[
              { label: "Enrolled", value: progress.enrolled_students },
              { label: "Not started", value: progress.not_started_count },
              { label: "Draft", value: progress.draft_count },
              { label: "Submitted", value: progress.submitted_count },
              { label: "Reopened", value: progress.reopened_count },
              { label: "Resubmitted", value: progress.resubmitted_count },
            ].map((item) => (
              <div key={item.label} className="rounded border border-gray-200 p-3 text-center">
                <p className="text-xs text-gray-500">{item.label}</p>
                <p className="text-lg font-semibold">{item.value}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {(status === "OPEN" || status === "CLOSED" || attemptTableRows.length > 0) && (
        <>
          <h2 className="mt-8 text-lg font-semibold">Attempts</h2>
          <AttemptsTable
            classId={classId}
            assignmentId={assignmentId}
            attempts={attemptTableRows}
          />
        </>
      )}

      <h2 className="mt-8 text-lg font-semibold">
        Questions ({questions?.length ?? 0})
      </h2>
      <QuestionManager
        assignmentId={assignmentId}
        questions={questions ?? []}
        hasResponses={hasResponses}
        editable={editable}
      />

      {imports && imports.length > 0 && (
        <>
          <h2 className="mt-8 text-lg font-semibold">Import history</h2>
          <ul className="mt-3 divide-y divide-gray-100 rounded border border-gray-200 text-sm">
            {imports.map((imp) => (
              <li key={imp.id} className="flex items-center justify-between px-3 py-2">
                <span>{imp.source_filename}</span>
                <span className="text-gray-500">
                  {new Date(imp.created_at).toLocaleString()}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    imp.status === "COMPLETED"
                      ? "bg-green-100 text-green-700"
                      : imp.status === "FAILED"
                        ? "bg-red-100 text-red-700"
                        : "bg-gray-100 text-gray-600"
                  }`}
                >
                  {imp.status}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
