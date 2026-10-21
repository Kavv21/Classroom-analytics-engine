"use client";

/**
 * The student area's error boundary. Without it a failed page load shows
 * Next.js's default "a server-side exception has occurred … Digest" screen.
 * The real error is already in the server log (Next.js logs every
 * server-component throw); the student gets a plain sentence and a way
 * forward. Answers in progress are kept in this browser by the grid, so
 * reloading loses nothing.
 */
export default function AssignmentsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="page-standard">
      <h1 className="title-md">This page didn&rsquo;t load</h1>
      <p className="note mt-2">
        Something got in the way of loading this page. Any answers you were working on are kept in
        this browser. Try again in a moment.
      </p>
      <button type="button" onClick={() => reset()} className="btn btn-primary mt-4">
        Try again
      </button>
    </main>
  );
}
