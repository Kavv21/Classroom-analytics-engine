# Import formats

Two importers exist: **roster** (students) and **assignment questions**.
Both preview before committing, and both fail loudly rather than skipping
a row they cannot interpret.

## Assignment questions (.xlsx)

Parsed by `lib/imports/parse-grid.ts`. The parser reads the real
spreadsheets used by this course; it was written against them rather than
against an idealised format.

### Expected shape

A grid where:

- One column contains a **numbered list** (1, 2, 3, …). This is how the
  parser locates the data block — it looks for a column that counts.
- The column immediately right of the number holds the **energy source**
  name (Solar, Wind, Coal, …).
- Columns to the right of that hold one **criterion** each, with the
  criterion name in a header row above the data block.
- Each (energy source × criterion) intersection becomes one question.

So a sheet with 15 energy sources and 2 criteria yields 30 questions;
15 × 17 yields 255.

### Generated fields

| Field | Source |
|---|---|
| `external_question_code` | `A1-001`, `A2-014` — prefix from the assignment's sequence number, ordinal from position |
| `question_text` | `"{energy source} — {criterion}"` |
| `energy_source`, `criterion` | The row/column labels, verbatim |
| `original_row_reference`, `original_column_reference` | Spreadsheet coordinates, retained for traceability |
| `display_order` | Position in the grid |
| `raw_source_payload` | The parsed row, kept as JSON |

**Question wording is never invented or paraphrased.** It is composed
only from the sheet's own labels.

### Failure behaviour

The parser reports an error (and the import commits nothing) when:

- a numbered row has an index but no name — the classic silent-skip trap;
- no numbered column can be found;
- a criteria header row cannot be located;
- the worksheet is empty or the named worksheet does not exist.

Import is **all-or-nothing**. A single bad row aborts the whole commit and
is recorded as a `FAILED` import with `REJECTED` rows, so the attempt is
visible in history without any partial data landing.

### Re-import

Re-importing into a `DRAFT` assignment with no responses **replaces** its
question set — the intended path after fixing a rejected file. Once any
response exists, import is blocked entirely; duplicate the assignment
instead.

### Verified counts

`npm run verify:extraction` re-checks the real files:

```
Assignment 1: 30 questions
Assignment 2: 255 questions
Total: 285
```

## Roster (.csv / .xlsx)

Parsed by `lib/roster/parse.ts`, classified by `lib/roster/validate.ts`.

### Columns

Required: name, enrollment number, email.
Optional: `programme`, `year_of_study`, `section` — imported when the file
carries them, never a reason to reject a row.

Header matching is deliberately forgiving, because no two institutional
exports name their columns the same way. `canonicalizeHeader()` folds case,
surrounding and repeated whitespace, invisible/non-breaking spaces, unicode
compatibility forms, and separator punctuation (`.`, `_`, `-`, `/`, …) before
comparing. So `"Roll No."`, `"roll_no"` and `"  ROLL   NO  "` are all the
same header.

`ROSTER_FIELDS` in `lib/roster/parse.ts` is the single source of truth for
which spellings map to which field — extend a spec's `aliases` there rather
than adding a second normalisation path:

| Field | Required | Accepted spellings include |
|---|---|---|
| `fullName` | yes | Name, Full Name, Student Name, Name of Student |
| `rollNumber` | yes | Enrollment Number, Enrolment No, Roll Number, Roll No, Student ID, Registration No |
| `email` | yes | Email, Email Address, Email ID, E-mail, Gmail, Student Email |
| `programme` | no | Programme, Program, Course, Degree, Branch |
| `yearOfStudy` | no | Year of Study, Year, Academic Year |
| `section` | no | Section, Sec, Division, Batch |

A required column that matches nothing is reported once at file level and on
every row, naming the field and the accepted spellings — e.g. `Missing: Email
column not found — expected one of: Email, Email Address, Email ID`. Headers
matching no field are listed back to the professor rather than silently
dropped.

### Row classification

Every row is classified against the database during preview and
**re-classified at commit** (the preview is never trusted):

| Classification | Meaning |
|---|---|
| `NEW` | Email unseen — a `roster_entries` row is created |
| `EXISTING_PROFILE` | Already provisioned via some class — enrolled directly into `class_members` |
| `DUPLICATE_IN_FILE` | Appears twice in the uploaded file |
| `DUPLICATE_ALREADY_IN_CLASS` | Already pending for this class |
| `DUPLICATE_PENDING_OTHER_CLASS` | Pending for a different class — rejected, not silently reassigned |
| `INVALID` | Missing/malformed name, enrollment number or email — the message names which |

`roster_entries.email` is globally unique, which is why the last two
cases exist. Cross-class checks go through the `check_roster_emails` RPC,
which answers only yes/no questions and never returns another class's
data.

Commit is transactional (`commit_roster_import`): a failure leaves no
partial roster.
