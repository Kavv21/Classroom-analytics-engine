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
import { assignmentStatusLabel, assignmentStatusTone } from "@/lib/ui/labels";

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

  // Every one of these depends only on the route params, so they run as a
  // single parallel batch rather than six sequential round-trips. Against
  // hosted Supabase (~60ms RTT) that is the difference between ~360ms and
  // ~60ms of network wait before this page can render.
  const [
    { data: assignment, error: assignmentError },
    { data: questions, error: questionsError },
    { count: responseCount, error: responseError },
    { data: progress, error: progressError },
    { data: attemptRows, error: attemptsError },
    { data: imports, error: importsError },
  ] = await Promise.all([
    supabase
      .from("assignments")
      .select(
        "id, class_id, title, description, instructions, assignment_stage, sequence_number, open_at, close_at, status, allow_draft_editing, allow_resubmission, response_zero_label, response_one_label"
      )
      .eq("id", assignmentId)
      .eq("class_id", classId)
      .maybeSingle(),
    supabase
      .from("questions")
      .select(
        "id, external_question_code, question_text, energy_source, criterion, response_zero_label, response_one_label, display_order"
      )
      .eq("assignment_id", assignmentId)
      .order("display_order", { ascending: true })
      .returns<QuestionRow[]>(),
    supabase
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId),
    supabase
      .from("assignment_submission_progress")
      .select(
        "enrolled_students, draft_count, submitted_count, reopened_count, resubmitted_count, not_started_count"
      )
      .eq("assignment_id", assignmentId)
      .maybeSingle<ProgressRow>(),
    supabase
      .from("assignment_attempts")
      .select(
        "id, state, submitted_at, reopened_at, submission_version, profiles!assignment_attempts_student_id_fkey(full_name, email)"
      )
      .eq("assignment_id", assignmentId)
      .order("submitted_at", { ascending: false, nullsFirst: false }),
    supabase
      .from("imports")
      .select("id, source_filename, status, created_at, summary")
      .eq("assignment_id", assignmentId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  // Errors are still surfaced individually so a failure names its own query.
  if (assignmentError) {
    throw new Error(`Failed to load assignment: ${assignmentError.message}`);
  }
  if (!assignment) notFound();
  if (questionsError) {
    throw new Error(`Failed to load questions: ${questionsError.message}`);
  }
  if (responseError) {
    throw new Error(`Failed to check responses: ${responseError.message}`);
  }
  if (progressError) {
    throw new Error(`Failed to load submission progress: ${progressError.message}`);
  }
  if (attemptsError) {
    throw new Error(`Failed to load attempts: ${attemptsError.message}`);
  }
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
    <main className="page-standard">
      <nav aria-label="Breadcrumb" className="note-muted">
        <Link href={`/classes/${classId}/assignments`} className="link-quiet">
          Assignments
        </Link>{" "}
        / #{assignment.sequence_number}
      </nav>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="title-md">{assignment.title}</h1>
        <span className={assignmentStatusTone(status)}>{assignmentStatusLabel(status)}</span>
      </div>

      <div className="note mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <span className="capitalize">
          {assignment.assignment_stage.replaceAll("_", " ").toLowerCase()}
        </span>
        <span>
          Answer labels: {assignment.response_zero_label} / {assignment.response_one_label}
        </span>
        {assignment.open_at && <span>Opens {new Date(assignment.open_at).toLocaleString()}</span>}
        {assignment.close_at && <span>Closes {new Date(assignment.close_at).toLocaleString()}</span>}
      </div>

      {assignment.description && <p className="note mt-4">{assignment.description}</p>}

      <div className="mt-6 flex flex-wrap gap-2">
        {editable && (
          <Link
            href={`/classes/${classId}/assignments/${assignmentId}/edit`}
            className="btn btn-secondary"
          >
            Edit details
          </Link>
        )}
        {status === "DRAFT" && !hasResponses && (
          <Link
            href={`/classes/${classId}/assignments/${assignmentId}/import`}
            className="btn btn-secondary"
          >
            Import questions
          </Link>
        )}
      </div>

      <h2 className="title-sm mt-10">Publishing</h2>
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
          <h2 className="title-sm mt-10">Submission progress</h2>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {[
              { label: "Enrolled", value: progress.enrolled_students },
              { label: "Not started", value: progress.not_started_count },
              { label: "In progress", value: progress.draft_count },
              { label: "Submitted", value: progress.submitted_count },
              { label: "Reopened", value: progress.reopened_count },
              { label: "Resubmitted", value: progress.resubmitted_count },
            ].map((item) => (
              <div key={item.label} className="card p-3 text-center">
                <p className="note-muted">{item.label}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums">{item.value}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {(status === "OPEN" || status === "CLOSED" || attemptTableRows.length > 0) && (
        <>
          <h2 className="title-sm mt-10">Student attempts</h2>
          <AttemptsTable
            classId={classId}
            assignmentId={assignmentId}
            attempts={attemptTableRows}
          />
        </>
      )}

      <h2 className="title-sm mt-10">Questions ({questions?.length ?? 0})</h2>
      <QuestionManager
        assignmentId={assignmentId}
        questions={questions ?? []}
        hasResponses={hasResponses}
        editable={editable}
      />

      {imports && imports.length > 0 && (
        <>
          <h2 className="title-sm mt-10">Import history</h2>
          <ul className="table-frame mt-3 divide-y divide-hairline bg-surface-raised text-sm">
            {imports.map((imp) => (
              <li key={imp.id} className="flex items-center justify-between gap-4 px-3 py-2">
                <span className="min-w-0 truncate">{imp.source_filename}</span>
                <span className="note-muted shrink-0">
                  {new Date(imp.created_at).toLocaleString()}
                </span>
                <span
                  className={
                    imp.status === "COMPLETED"
                      ? "badge badge-good shrink-0"
                      : imp.status === "FAILED"
                        ? "badge badge-critical shrink-0"
                        : "badge shrink-0"
                  }
                >
                  {imp.status === "COMPLETED"
                    ? "Imported"
                    : imp.status === "FAILED"
                      ? "Failed"
                      : "In progress"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
