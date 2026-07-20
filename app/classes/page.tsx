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
    <main className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Your classes</h1>
        <Link
          href="/classes/new"
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
        >
          New class
        </Link>
      </div>

      {!classes || classes.length === 0 ? (
        <p className="mt-6 text-gray-600">You haven&apos;t created any classes yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded border border-gray-200">
          {classes.map((c) => (
            <li key={c.id}>
              <Link
                href={`/classes/${c.id}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50"
              >
                <div>
                  <p className="font-medium">{c.name}</p>
                  <p className="text-sm text-gray-600">
                    {[c.course_name, c.academic_year, c.semester, c.section]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${
                    c.status === "ARCHIVED"
                      ? "bg-gray-100 text-gray-600"
                      : "bg-green-100 text-green-700"
                  }`}
                >
                  {c.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
