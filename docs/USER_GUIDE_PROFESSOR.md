# Professor guide

Everything below describes screens that exist today.

## 1. Sign in

Go to the app and choose **Sign in with Google**, using your university
account. Your account must already exist as a professor — an administrator
creates it (there is no self-signup).

## 2. Create a class

**Your classes → Create a class.** Only the class name is required; course
name, year, semester, and section can be filled in later from the same
screen.

## 3. Import your roster

Open the class → **Import a roster**.

Upload a CSV or Excel file with name, enrollment number, and email columns.
Any other columns (programme, year, section) are optional and imported if
present. Column headings don't have to match exactly — common variations
like "Full Name", "Roll No." or "Email Address" are recognised, and if a
required column can't be found the preview tells you which one and what it
can be called. You will see a preview
that classifies every row before anything is saved — new students,
students already enrolled, duplicates, and invalid rows are listed
separately. Nothing is written until you confirm.

Students do not have accounts yet at this point. Each student gets one the
first time they sign in with the Google account matching their roster
email. Until they do, they show as "Awaiting first sign-in".

## 4. Create and set up an assignment

Class → **Manage assignments → Create an assignment**.

Set the **sequence number**: `1` for the first assignment, `2` for the
second. This is what pairs them for comparison later — it is not cosmetic.

Then **Import questions** and upload the assignment spreadsheet. You will
see the parsed questions before committing. If any row can't be read, the
import is refused entirely and tells you which row — nothing partial is
saved. Fix the file and upload again.

You can adjust the answer labels (what "0" and "1" mean) per question, and
reorder questions.

## 5. Approve, then schedule

There is no "publish" button. An assignment opens and closes **on its own,
at the times you set** — you do not have to be at a computer at 9am to let
the class in, or at midnight to shut them out.

On the assignment page, under **Availability**:

1. Tick "I have reviewed all N questions" and choose **Mark ready to
   schedule**. This is still a deliberate approval of the question list,
   and it is still yours to give — nothing about the dates replaces it.
   Students still cannot see the assignment.
2. Choose **Set the schedule**, and fill in **Opens at** and **Closes at**.
   Both are required: an assignment with only one of them is not scheduled,
   and nobody can reach it. The times are in **your own timezone** (the
   form says which one it detected).

That is all. At the opening time students can start; at the closing time
the assignment stops accepting answers, saves and submissions alike. In
between, the assignment page reads "Open until …" rather than a status you
have to translate.

**To end it early or run it longer, change the closing time** — that is the
normal way to adjust access. Before it opens, students can see that the
assignment is coming and when, but not its questions.

Two other buttons, which are not schedule changes:

* **Close to students now** retires the assignment whatever the dates say.
  Use it when you are finished with it — it is the step before archiving.
  A retired assignment can be put back on the calendar with **Reschedule**.
* **Archive assignment** puts it away entirely.

*If you have assignments from before this change, they are still in the old
"open until you close it" mode and keep working. Give one an opening and a
closing time to move it onto the calendar.*

Once any student has answered, question wording and labels lock. You can
still reorder. To change the questions themselves, use **Duplicate** and
edit the copy.

## 6. Let students answer again

There are three different gestures, and they are not interchangeable.
Every one of them affects **this assignment only** — nobody's other
assignments are touched, and a submitted attempt stays read-only until one
of these is used on it.

**One student**: assignment page → **Student attempts** → **Reopen** next
to them. They can edit and resubmit; their submission version increments,
and their attempt locks again as soon as they resubmit. This works whether
the assignment is open or closed — a closed assignment stays closed to
everyone else. Only you can do this; students cannot reopen their own work.

**Every student who has submitted**: assignment page → **Student
attempts** → **Reopen for all students**, then confirm. It reopens every
SUBMITTED attempt on this assignment, and only this assignment. Students
still drafting are left alone, the assignment's own status doesn't change,
and each attempt locks again the moment its student resubmits.

**The whole class, including people who never submitted**: assignment page
→ **Reopen to students**, on a closed assignment. This one changes the
assignment's status back to open: anyone who hadn't submitted can carry
on, and anyone whose attempt you reopened individually can submit again.
You can close it again afterwards.

If a student says a reopened assignment still shows as closed with no way
in, check its status: before this was fixed, reopening an attempt on a
closed assignment produced exactly that dead end.

## 7. Read the analytics

Class → **View analytics**. Four sections:

- **Overview** — per-assignment headline counts, average consensus and
  entropy, plus the submission snapshot.
- **Assignment analytics** — response distributions, agreement, submission
  progress and timeline.
- **Students** — everyone enrolled and where they are in each assignment,
  with a link from each row to that student's **full responses**.
- **Visualisation builder** — build your own chart.

### Where individual answers live

Two views, and the split is deliberate:

- **Assignment → View response totals** is **aggregate-only**. It shows each
  question's class totals in the source spreadsheet's own column order, plus
  a subtotal per energy source. It contains no student rows, no names and no
  individual answers. The Excel workbook's `Grid — …` sheets show the same
  thing, with live `SUM` formulas across each energy source's questions.
- **Analytics → Students → a student's full responses** is the one place an
  individual's answers appear: every question on both assignments — all 30
  on Assignment 1 and all 255 on Assignment 2 — with the 0/1 they recorded.
  It is laid out as **the original spreadsheet's own grid**, the same rows,
  columns and order as the response-totals grid and as the sheet the student
  answered on, so the three can be read side by side. A cell holds their 0
  or 1; a `·` means they left it blank, which is not the same as a 0. There
  is **no total row** on a student's grid — a figure summing one person's
  answers would read as a score. Underneath, **Show question-by-question
  list** opens the same answers as a searchable list carrying each
  question's full wording.
  **Download as Excel** on that page gives you one student's grid as an
  .xlsx: one sheet per assignment in the source file's shape, plus an
  `Answers by question` sheet with the verbatim wording, and a header block
  naming the student, when it was generated, and whether the record is
  synthetic demo data.

One thing worth knowing: **this tool does not compare one student's
Assignment 1 answer with their Assignment 2 answer.** Doing so would need a
record declaring which question corresponds to which, and that feature was
removed. The two assignments are compared only in aggregate, per energy
source.

Nothing here is a grade. There are no right answers in this data.

## 8. Export

- **Export full workbook (Excel)** from the builder page — sheets covering
  students, questions, responses, per-question analytics, the response
  grids, and import validation.
- **CSV / PDF** for whatever the builder is currently showing.

Every export records the class, assignments, when it was generated, the
filters in effect and the metric definitions — so a file opened months
later can still be read correctly.

## 9. Teaching assistants

**Teaching assistants** on a class's page. Add someone by email; if they
already have an account they get access immediately, and if they have never
signed in they get it the first time they do. Their own role elsewhere is
untouched — a colleague who is a professor of their own classes stays one.

A teaching assistant can do everything on this list for that one class:
roster, assignments, questions, publishing, reopening, analytics, exports,
and archiving or deleting an *assignment*. They cannot archive or delete
the **class**, and they cannot add or remove other assistants. Those two
stay with you, and they are refused by the database, not just hidden from
the page.

Removing an assistant takes their access away at once. Nothing they did to
the class is undone, and their account and any other class they belong to
are unaffected.

## What this tool does not do

No grades, marks, or correct answers. No proctoring, tab-switch detection,
or any monitoring of students while they work. An assignment closes on its
deadline; nothing auto-submits on a student's behalf.
