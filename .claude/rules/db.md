# Rules: database & migrations

Applies whenever touching `/supabase/migrations`, `/db`, or RLS policies.

- Every schema change is a new migration file. Never edit an already-applied
  migration; write a new one.
- Every table holding student data gets an RLS policy in the same PR that
  creates the table — not "TODO: add RLS later."
- `response_value` CHECK constraint (`0`, `1`, or `NULL`) is mandatory on
  `responses`. Do not relax it to accept other values, even temporarily.
- Unique constraint on `(attempt_id, question_id)` in `responses` — no
  duplicate answers per question per attempt.
- Attempt state transitions are enforced server-side against the exact list
  in `/docs/DATABASE_SCHEMA.md`. Reject anything not on that list.
- If `/docs/DATABASE_SCHEMA.md` and the actual schema disagree after your
  change, update the doc in the same commit.
- Full schema reference: `/docs/DATABASE_SCHEMA.md`.
