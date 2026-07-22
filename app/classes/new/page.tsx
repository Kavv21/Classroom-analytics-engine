"use client";

import { ClassForm } from "@/components/classes/class-form";
import { createClass } from "@/lib/classes/actions";

export default function NewClassPage() {
  return (
    <main className="page-standard max-w-xl">
      <h1 className="title-md">Create a class</h1>
      <p className="note mt-1">
        Only the class name is required — you can fill in the rest later.
      </p>
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
