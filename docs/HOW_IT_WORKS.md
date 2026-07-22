# How This App Actually Works

A plain-language guide to everything we've built today. Read this once
top to bottom, then use it as a reference — ctrl+F for whatever term
you've forgotten.

---

## 1. The big picture

Two separate things talk to each other:

- **Next.js** (the app you see at `localhost:3000`) — this is the website
  itself: pages, buttons, forms. Runs partly in your browser, partly on a
  server.
- **Supabase** (the dashboard at supabase.com) — this is the database and
  everything guarding it. It has no idea what a "button" is. It just
  stores rows of data and enforces rules about who can read/write which
  rows.

Your Next.js app never talks to the database directly with raw trust —
every request goes through Supabase's permission layer first. That's the
whole point of today's pain: getting that permission layer correct.

---

## 2. Core database concepts (the ones that caused today's bugs)

### Migration
A **migration** is just a text file of SQL commands (`create table ...`,
`alter table ...`) that changes the database's structure. They're
numbered (`0001`, `0002`, ...) and applied in order, once each, forever —
you never edit an old one, you write a new one that changes things
further. This is how the database's structure is version-controlled,
same as your code is version-controlled with git.

`npx supabase db push` is the command that actually runs any migration
files that haven't been applied yet, against your real database.

### Table
A table is exactly what it sounds like — rows and columns, like a
spreadsheet. `profiles`, `classes`, `responses` — each is one table.

### RLS (Row-Level Security)
This is Postgres's built-in permission system, per **row**, not just per
table. Example: the `responses` table has millions of potential rows (one
per student per question), and RLS is the rule that says "a student can
only see rows where `student_id` matches *their own* logged-in ID." It's
not the app checking this — it's the database itself refusing to hand
back rows that don't match, even if a bug in the app tried to ask for
them. That's why it's the real security boundary, not a nice-to-have.

A **policy** is one specific rule, e.g. `classes_professor_manage` says
"a professor can do anything to a `classes` row where `professor_id`
equals their own ID."

### GRANT
Before RLS even gets a chance to check anything, Postgres asks a simpler
question first: "is this role even allowed to touch this table at all?"
A **GRANT** is what answers yes to that question. This is the thing that
was *missing* for hours today — RLS policies were all correctly written,
but without the base GRANT, Postgres rejected every query before RLS ever
ran. Lesson: RLS is a *filter*, GRANT is the *door*. You need both.

### Trigger
A trigger is code that runs **automatically** whenever something happens
to a table — e.g. "whenever a new row is inserted into `auth.users`
(someone logs in for the first time), automatically run this function to
create their profile." You never call a trigger directly; it fires on its
own. Today's `handle_new_user()` is a trigger.

### Security definer function
A normal database function runs with *your* permissions when you call it.
A **security definer** function runs with the permissions of whoever
*created* it — usually a highly-trusted role. This is how we let a
student's login trigger create a `profiles` row for them, even though
students don't have general permission to insert into `profiles` — the
trigger briefly "borrows" more trusted permissions to do one specific,
controlled thing.

### View
A view is a saved *query*, dressed up to look like a table. `select *
from class_transition_summary` looks like reading a table, but it's
actually re-running a calculation live every time you ask. This is how
Phase 7's analytics work — every number you see (change rate, consensus,
etc.) is computed fresh from the raw responses each time the page loads,
not stored and recalculated on a schedule.

### Immutability trigger
A special kind of trigger that *blocks* an action rather than doing one —
e.g. "reject any attempt to delete a question if students have already
answered it." This is how the app enforces "you can't edit a published
assignment's questions once responses exist" as a hard rule, not just a
UI suggestion.

---

## 3. Core Next.js concepts

### Server Component vs Client Component
Every page is one or the other. A **Server Component** runs on the
server, can talk directly to the database, but can't have interactive
things like `onClick`. A **Client Component** runs in the browser, can be
interactive, but can't directly query the database. This split is *why*
today's "function passed across the boundary" bug happened — a Server
Component tried to hand a Client Component a piece of literal code
(a function), which isn't allowed to cross that line; only data (text,
numbers) or specially-marked Server Actions can cross it.

### Server Action
A specific function marked `"use server"` that a Client Component
(a button, a form) is allowed to call, even though it actually runs back
on the server. `createClass()`, `submitAttempt()` — these are Server
Actions. This is the *sanctioned* way for a button click to cause a
database write.

### Middleware
Code that runs on **every single request**, before any page loads —
this is where "does this logged-in user actually have a profile?" gets
checked, redirecting to `/not-provisioned` if not. It's the bouncer at
the door of every page.

---

## 4. The actual data flow, start to finish

This is the story of what happens as your app gets used for real:

1. **A professor imports Assignment 1 and Assignment 2** — each question
   from the Excel files becomes a row in the `questions` table.
2. **The professor maps questions between the two assignments** in the
   Mapping Studio — e.g. "Solar's renewable question in Assignment 1"
   is declared equivalent to "Solar's renewable question in Assignment 2."
   This creates a row in `question_mappings`, starting as unapproved.
3. **The professor approves that mapping.** Only now does it "count" for
   anything — an unapproved mapping is invisible to all analytics.
4. **A student answers Assignment 1**, one 0/1 answer per question,
   saved as rows in `responses`. They submit — this locks in their
   answers as final.
5. Time passes ("the professor teaches outside the platform").
6. **The same student answers Assignment 2.**
7. Now, for that one approved mapping, the app can look at the student's
   two answers (0 or 1 on each side) and classify the pair into one of
   four buckets:
   - **S00** — said 0 both times (no change)
   - **S01** — said 0, then 1 (opinion shifted toward "yes")
   - **S10** — said 1, then 0 (opinion shifted toward "no")
   - **S11** — said 1 both times (no change)
8. **Across all students**, these get totaled up into the metrics you
   see on the Analytics page:
   - **Change rate** — what fraction of students changed their answer at
     all (S01 + S10 combined)
   - **Net shift** — which *direction* the change leaned, on net (S01
     minus S10) — this is different from change rate; a class could have
     huge change rate but zero net shift if people flip both ways equally
   - **Consensus** — how much the class agrees with each other (not with
     any "correct" answer — there is no correct answer) — 100% if
     everyone picked the same value, 50% if it's an even split
   - **Entropy** — a more precise mathematical version of "how mixed are
     the opinions," maxed out at an even 50/50 split
9. **All of this renders as charts** on the Analytics page — heatmaps,
   Sankey diagrams, ranking charts — all just different visual framings
   of the same underlying S00/S01/S10/S11 counts.

Nowhere in this entire pipeline is there a concept of "correct." Every
number describes what people *said*, never whether they were *right*.

---

## 5. Project-specific vocabulary

- **Roster entry** — a row saying "this email should become a
  student/professor of this class once they log in." Exists *before* the
  person's actual account does.
- **Provisioning** — the moment a `roster_entries` row turns into a real
  `profiles` row, triggered automatically by first login.
- **Attempt** — one student's one try at one assignment. Has a state:
  `NOT_STARTED → DRAFT → SUBMITTED`, and can be `REOPENED` by the
  professor if the student needs to fix something after submitting.
- **Mapping type** (`EXACT_ONE_TO_ONE`, `GROUPED_CONCEPT`, etc.) —
  describes *how* a question in Assignment 1 relates to one or more
  questions in Assignment 2. Most of your data has a clean 1-to-1 match;
  some doesn't, and gets marked `NOT_COMPARABLE` rather than forced into
  a comparison that wouldn't mean anything.
- **Exploratory analytics** — the more advanced statistical views
  (clustering, similarity scores) that are explicitly labeled as "for
  poking around," not as findings — the spec is strict that these never
  get treated as conclusions.

---

## 6. What each phase actually added, in one line each

1. **Extraction** — read the Excel files, got every question into the database.
2. **Foundation** — the database schema + login system.
3. **Classes & rosters** — professor creates a class, imports a student list.
4. **Assignments** — professor publishes Assignment 1 / Assignment 2.
5. **Student responses** — the actual screen students use to answer.
6. **Mapping studio** — linking Assignment 1 questions to Assignment 2 questions.
7. **Analytics engine** — the math (S00-S11, change rate, consensus) as live database views.
8. **Visualisations** — the 14 chart types rendering that math.
9. **Query builder & exports** — lets the professor build custom views and download data.
10. **Testing & deployment** — proving it all actually works, then shipping it.
