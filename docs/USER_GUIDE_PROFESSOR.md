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

Upload a CSV or Excel file with `email` and `full_name` columns (roll
number, programme, year, and section are optional). You will see a preview
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

## 5. Publish

On the assignment page, under **Publishing**:

1. Tick "I have reviewed all N questions" and choose **Mark ready to
   publish**. Students still cannot see it.
2. Choose **Publish to students**. It is now open.

Later: **Close assignment** stops submissions; **Archive assignment** puts
it away.

Once any student has answered, question wording and labels lock. You can
still reorder. To change the questions themselves, use **Duplicate** and
edit the copy.

## 6. Let students answer again

There are two different gestures, and they are not interchangeable.

**One student**: assignment page → **Student attempts** → **Reopen** next
to them. They can edit and resubmit; their submission version increments.
This works whether the assignment is open or closed — a closed assignment
stays closed to everyone else. Only you can do this; students cannot
reopen their own work.

**The whole class**: assignment page → **Reopen to students**, on a closed
assignment. Anyone who hadn't submitted can carry on, and anyone whose
attempt you reopened individually can submit again. You can close it again
afterwards.

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
  on Assignment 1 and all 255 on Assignment 2 — with the 0/1 they recorded,
  grouped by energy source.

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

## What this tool does not do

No grades, marks, or correct answers. No proctoring, tab-switch detection,
or any monitoring of students while they work. An assignment closes on its
deadline; nothing auto-submits on a student's behalf.
