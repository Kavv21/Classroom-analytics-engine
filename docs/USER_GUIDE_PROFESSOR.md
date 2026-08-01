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

## 6. Reopen a student's attempt

Assignment page → **Student attempts** → **Reopen** next to the student.
They can then edit and resubmit; their submission version increments. Only
you can do this — students cannot reopen their own work.

## 7. Map the two assignments

Class → **Open mapping studio**.

This is the step that makes comparison possible. Assignment 1's questions
are on the left, Assignment 2's on the right. Search or filter either side
by wording, energy source, criterion, or concept.

**Generate suggestions** proposes matches using plain text and keyword
matching — no AI, and nothing is approved automatically.

Select questions on each side, give the mapping a name and type, and
create it. Then:

- **Preview** shows what the mapping *would* report, before you approve it.
- **Approve** makes it live in analytics.
- **Reject** sets it aside.

**Nothing appears in analytics until you approve it.** This is enforced in
the database, not just hidden in the interface.

Approved mappings cannot be edited — use **New version**. The old version
stays live until you approve the new one, so analytics never goes blank
mid-change.

## 8. Read the analytics

Class → **View analytics**. Five sections:

- **Overview** — headline counts and rates.
- **Assignment analytics** — response distributions, agreement, submission
  progress and timeline.
- **Transition analytics** — how answers moved between the assignments,
  including the drill-down: energy source → criterion → question →
  transition → the students in it → one student's full profile.
- **Student analytics** — per-student movement, and a link from each row to
  that student's **full profile**.
- **Visualisation builder** — build your own chart.

### Where individual answers live

Two views, and the split is deliberate:

- **Assignment → View response totals** is **aggregate-only**. It shows each
  question's class totals in the source spreadsheet's own column order, plus
  a subtotal per energy source. It contains no student rows, no names and no
  individual answers. The Excel workbook's `Grid — …` sheets show the same
  thing, with live `SUM` formulas across each energy source's questions.
- **Analytics → Students → a student's full profile** is the one place an
  individual's answers appear. It has two tabs: **Opinion shift** (the
  approved mappings and how that student moved between the paired questions)
  and **Full responses** (every question on both assignments — all 30 on
  Assignment 1 and all 255 on Assignment 2 — with the 0/1 they recorded,
  grouped by energy source, whether or not the question is mapped).

Two things worth knowing:

- **Change rate and shift are different.** Change rate counts all movement
  in both directions; shift is the net balance. A group can have a high
  change rate and a shift of zero.
- **Missing and not-comparable answers are reported separately** and are
  never counted as if they were a change or a non-change.

Nothing here is a grade. There are no right answers in this data.

## 9. Export

- **Export full workbook (Excel)** from the builder page — 10 sheets
  covering students, questions, responses, mappings, transitions, and
  analytics.
- **CSV / PDF** for whatever the builder is currently showing.
- **CSV / JSON** of the mapping table from the mapping studio.

Every export records the class, assignments, when it was generated, the
filters in effect, the metric definitions, and which mapping versions were
approved at the time — so a file opened months later can still be read
correctly.

## What this tool does not do

No grades, marks, or correct answers. No proctoring, tab-switch detection,
or any monitoring of students while they work. An assignment closes on its
deadline; nothing auto-submits on a student's behalf.
