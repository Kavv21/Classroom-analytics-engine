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
    <main className="mx-auto max-w-xl p-8">
      <p className="text-sm text-gray-500">
        <Link href={`/classes/${classId}/assignments`} className="hover:underline">
          Assignments
        </Link>{" "}
        / New
      </p>
      <h1 className="mt-2 text-2xl font-bold">New assignment</h1>
      <div className="mt-6">
        <AssignmentForm
          onSubmitAction={createAssignment.bind(null, classId)}
          submitLabel="Create assignment"
          redirectOnSuccess={(id) => `/classes/${classId}/assignments/${id}`}
        />
      </div>
    </main>
  );
}
