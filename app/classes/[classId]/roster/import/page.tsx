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
        Upload a CSV or Excel file with columns for name, enrollment number, and email. Other
        columns are optional and will be imported if present. Column headings don&apos;t have to
        match exactly — common variations like &ldquo;Full Name&rdquo;, &ldquo;Roll No.&rdquo; or
        &ldquo;Email Address&rdquo; are recognised. You&apos;ll see a preview — including any
        duplicates or validation errors — before anything is imported.
      </p>

      <div className="mt-6">
        <RosterImportWizard classId={classId} />
      </div>
    </main>
  );
}
