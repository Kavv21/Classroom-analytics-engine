import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { EditClassForm } from "@/components/classes/edit-class-form";
import { ArchiveButton } from "@/components/classes/archive-button";
import { StudentActiveToggle } from "@/components/classes/student-active-toggle";

interface ClassMemberRow {
  id: string;
  status: string;
  profiles: {
    id: string;
    full_name: string | null;
    email: string;
    roll_number: string | null;
    is_active: boolean;
  } | null;
}

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const supabase = await createClient();

  const { data: classRow } = await supabase
    .from("classes")
    .select(
      "id, name, course_name, academic_year, semester, section, class_code, start_date, end_date, status"
    )
    .eq("id", classId)
    .maybeSingle();

  if (!classRow) notFound();

  const { count: memberCount } = await supabase
    .from("class_members")
    .select("id", { count: "exact", head: true })
    .eq("class_id", classId);

  const { count: pendingCount } = await supabase
    .from("roster_entries")
    .select("id", { count: "exact", head: true })
    .eq("class_id", classId)
    .eq("provisioned", false);

  const { data: members } = await supabase
    .from("class_members")
    .select("id, status, profiles(id, full_name, email, roll_number, is_active)")
    .eq("class_id", classId)
    .order("joined_at", { ascending: true })
    .returns<ClassMemberRow[]>();

  return (
    <main className="mx-auto max-w-2xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{classRow.name}</h1>
        <ArchiveButton classId={classRow.id} status={classRow.status} />
      </div>

      <div className="mt-4 flex gap-6 rounded border border-gray-200 p-4 text-sm">
        <div>
          <p className="text-gray-500">Enrolled students</p>
          <p className="text-lg font-semibold">{memberCount ?? 0}</p>
        </div>
        <div>
          <p className="text-gray-500">Awaiting first sign-in</p>
          <p className="text-lg font-semibold">{pendingCount ?? 0}</p>
        </div>
        <div className="ml-auto self-center">
          <Link
            href={`/classes/${classId}/roster/import`}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
          >
            Import roster
          </Link>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded border border-gray-200 p-4">
        <div>
          <p className="font-medium">Assignments</p>
          <p className="text-sm text-gray-600">
            Create, import, and publish this class&rsquo;s assignments.
          </p>
        </div>
        <Link
          href={`/classes/${classId}/assignments`}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Manage assignments
        </Link>
      </div>

      <h2 className="mt-8 text-lg font-semibold">Roster</h2>
      {!members || members.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">
          No students enrolled yet. Use &ldquo;Import roster&rdquo; above to add some.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 font-medium text-gray-600">Name</th>
                <th className="px-3 py-2 font-medium text-gray-600">Email</th>
                <th className="px-3 py-2 font-medium text-gray-600">Roll number</th>
                <th className="px-3 py-2 font-medium text-gray-600">Status</th>
                <th className="px-3 py-2 font-medium text-gray-600" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members
                .filter((m): m is ClassMemberRow & { profiles: NonNullable<ClassMemberRow["profiles"]> } =>
                  !!m.profiles
                )
                .map((m) => (
                  <tr key={m.id}>
                    <td className="px-3 py-2">{m.profiles.full_name ?? "—"}</td>
                    <td className="px-3 py-2">{m.profiles.email}</td>
                    <td className="px-3 py-2">{m.profiles.roll_number ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          m.profiles.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {m.profiles.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <StudentActiveToggle
                        classId={classId}
                        profileId={m.profiles.id}
                        isActive={m.profiles.is_active}
                      />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold">Class details</h2>
      <div className="mt-4">
        <EditClassForm
          classId={classRow.id}
          defaultValues={{
            name: classRow.name,
            courseName: classRow.course_name ?? "",
            academicYear: classRow.academic_year ?? "",
            semester: classRow.semester ?? "",
            section: classRow.section ?? "",
            classCode: classRow.class_code ?? "",
            startDate: classRow.start_date ?? "",
            endDate: classRow.end_date ?? "",
          }}
        />
      </div>
    </main>
  );
}
