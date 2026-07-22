import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function ClassesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: classes } = user
    ? await supabase
        .from("classes")
        .select("id, name, course_name, academic_year, semester, section, status")
        .eq("professor_id", user.id)
        .order("created_at", { ascending: false })
    : { data: null };

  return (
    <main className="page-standard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="title-md">Your classes</h1>
        <Link href="/classes/new" className="btn btn-primary">
          Create a class
        </Link>
      </div>

      {!classes || classes.length === 0 ? (
        <p className="banner mt-6">
          You haven&rsquo;t created a class yet. Create one to import a roster
          and set up assignments.
        </p>
      ) : (
        <ul className="table-frame mt-6 divide-y divide-hairline">
          {classes.map((c) => (
            <li key={c.id}>
              <Link
                href={`/classes/${c.id}`}
                className="flex items-center justify-between gap-4 bg-surface-raised p-4 hover:bg-surface-sunken"
              >
                <div className="min-w-0">
                  <p className="font-medium">{c.name}</p>
                  <p className="note mt-0.5">
                    {[c.course_name, c.academic_year, c.semester, c.section]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span className={c.status === "ARCHIVED" ? "badge" : "badge badge-good"}>
                  {c.status === "ARCHIVED" ? "Archived" : "Active"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
