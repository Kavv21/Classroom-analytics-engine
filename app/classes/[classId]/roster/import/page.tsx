import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RosterImportWizard } from "@/components/roster/roster-import-wizard";

export default async function RosterImportPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const supabase = await createClient();

  const { data: classRow } = await supabase
    .from("classes")
    .select("id, name")
    .eq("id", classId)
    .maybeSingle();

  if (!classRow) notFound();

  return (
    <main className="mx-auto max-w-4xl p-8">
      <p className="text-sm text-gray-500">
        <Link href={`/classes/${classId}`} className="hover:underline">
          {classRow.name}
        </Link>{" "}
        / Import roster
      </p>
      <h1 className="mt-1 text-2xl font-bold">Import roster</h1>
      <p className="mt-2 text-sm text-gray-600">
        Upload a CSV or Excel file with columns for email, full name, roll number, programme, year
        of study, and section. You&apos;ll see a preview — including any duplicates or validation
        errors — before anything is imported.
      </p>

      <div className="mt-6">
        <RosterImportWizard classId={classId} />
      </div>
    </main>
  );
}
