import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";

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
        <Button asChild>
          <Link href="/classes/new">Create a class</Link>
        </Button>
      </div>

      {!classes || classes.length === 0 ? (
        <Alert className="mt-6">
          <AlertDescription>
            You haven&rsquo;t created a class yet. Create one to import a roster
            and set up assignments.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="mt-6 overflow-hidden p-0">
          <CardContent className="p-0">
            <ul className="divide-y">
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
                <Badge
                  variant="outline"
                  className={
                    c.status === "ARCHIVED"
                      ? "border-transparent bg-surface-sunken text-ink-secondary"
                      : "border-transparent bg-surface-good text-[color:var(--status-good-text)]"
                  }
                >
                  {c.status === "ARCHIVED" ? "Archived" : "Active"}
                </Badge>
              </Link>
            </li>
          ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
