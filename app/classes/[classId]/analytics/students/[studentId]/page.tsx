import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { StudentProfile } from "@/components/analytics/student-profile";
import { Button } from "@/components/ui/button";
import { requireClassStaffPage } from "@/lib/analytics/page-data";
import { getStudentFullResponses } from "@/lib/analytics/student-responses";

/**
 * One student's profile: their FULL raw submission on every assignment.
 *
 * This is the only surface in the app that shows an individual student's
 * answers. The assignment response grid is aggregate-only — it carries class
 * totals per question and no student rows — so a professor who needs to see
 * what one person actually recorded comes here.
 *
 * Access: staff-of-this-class only (its professor or one of its TAs).
 * `requireClassStaffPage` yields a
 * clean 404 for anyone else, and RLS is the real boundary underneath it. The
 * student must also be a member of THIS class, so a professor cannot reach
 * another class's student by editing the URL.
 */

export default async function StudentProfilePage({
  params,
}: {
  params: Promise<{ classId: string; studentId: string }>;
}) {
  const { classId, studentId } = await params;
  const { supabase, classRow } = await requireClassStaffPage(classId);
  if (!classRow) notFound();

  // The membership row and the responses are both keyed on
  // (classId, studentId) — the responses do not wait on the membership
  // check, they are just discarded with the 404 if it fails. Fetching
  // them together turns this page's slowest read into its only read.
  const [{ data: member, error: memberError }, assignments] = await Promise.all([
    supabase
      .from("class_members")
      .select("user_id, status, is_synthetic, profiles(full_name, email, student_identifier)")
      .eq("class_id", classId)
      .eq("user_id", studentId)
      .eq("member_role", "STUDENT")
      .maybeSingle<{
        user_id: string;
        status: string;
        is_synthetic: boolean;
        profiles: {
          full_name: string | null;
          email: string;
          student_identifier: string | null;
        } | null;
      }>(),
    getStudentFullResponses(supabase, classId, studentId),
  ]);
  if (memberError) {
    throw new Error(`Could not load student: ${memberError.message}`);
  }
  if (!member) notFound();

  const profile = member.profiles;
  const studentName = profile?.full_name ?? profile?.email ?? `Student ${studentId.slice(0, 8)}`;
  const { is_synthetic: isSynthetic, status } = member;

  return (
    <main className="page-dense">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1">{classRow.name}</p>
          <h1 className="title-md">{studentName}</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            {profile?.student_identifier ? `${profile.student_identifier} · ` : ""}
            {profile?.email ?? "no email on file"}
            {status !== "ACTIVE" ? ` · ${status.toLowerCase()} in this class` : ""}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/classes/${classId}/analytics/students`}>Back to students</Link>
        </Button>
      </div>

      <AnalyticsNav classId={classId} active="students" />

      {isSynthetic && (
        <p className="mt-4 rounded border border-dashed border-hairline px-3 py-2 text-xs text-ink-secondary">
          This is a <strong>synthetic demo record</strong>, not a real student. Its answers were
          generated for demonstration and describe no one.
        </p>
      )}

      <StudentProfile
        studentName={studentName}
        assignments={assignments}
        exportHref={`/classes/${classId}/analytics/students/${studentId}/export`}
      />
    </main>
  );
}
