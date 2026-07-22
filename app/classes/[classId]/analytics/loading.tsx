export default function AnalyticsLoading() {
  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="h-8 w-72 animate-pulse rounded bg-gray-200" />
      <div className="mt-2 h-4 w-96 animate-pulse rounded bg-gray-100" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="mt-8">
          <div className="h-6 w-48 animate-pulse rounded bg-gray-200" />
          <div className="mt-3 h-24 animate-pulse rounded border border-gray-200 bg-gray-50" />
        </div>
      ))}
      <p className="mt-6 text-sm text-gray-500">Computing analytics…</p>
    </main>
  );
}
