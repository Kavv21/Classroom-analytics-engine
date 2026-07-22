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
    <main className="page-dense-narrow max-w-4xl">
      <p className="text-sm text-ink-muted">
        <Link href={`/classes/${classId}`} className="hover:underline">
          {classRow.name}
        </Link>{" "}
        / Import roster
      </p>
      <h1 className="title-md mt-1">Import roster</h1>
      <p className="mt-2 text-sm text-ink-secondary">
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
