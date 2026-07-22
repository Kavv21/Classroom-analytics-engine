import Link from "next/link";
import { AssignmentForm } from "@/components/assignments/assignment-form";
import { createAssignment } from "@/lib/assignments/actions";

export default async function NewAssignmentPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;

  return (
    <main className="page-standard max-w-xl">
      <p className="text-sm text-ink-muted">
        <Link href={`/classes/${classId}/assignments`} className="hover:underline">
          Assignments
        </Link>{" "}
        / New
      </p>
      <h1 className="title-md mt-2">New assignment</h1>
      <div className="mt-6">
        <AssignmentForm
          onSubmitAction={createAssignment.bind(null, classId)}
          submitLabel="Create assignment"
          redirectBasePath={`/classes/${classId}/assignments`}
        />
      </div>
    </main>
  );
}
