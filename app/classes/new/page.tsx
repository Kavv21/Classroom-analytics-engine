"use client";

import { ClassForm } from "@/components/classes/class-form";
import { createClass } from "@/lib/classes/actions";

export default function NewClassPage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-bold">New class</h1>
      <div className="mt-6">
        <ClassForm
          onSubmitAction={createClass}
          submitLabel="Create class"
          redirectBasePath="/classes"
        />
      </div>
    </main>
  );
}
