# Phase 1 — Repository & Source Inspection

**Agent:** single agent, no worktree split yet.
**Spec sections:** 4, 5, and Section 32 "Phase 1."

## Goal

Inspect the repo, locate the two source spreadsheets, extract every
question with exact wording, produce manifests + appendix. Nothing
downstream may start until this is reviewed by a human and correct.

## Tasks

1. Inspect the existing repository structure (if any) before changing
   anything.
2. Locate `/source-assignments/assignment-1.xlsx` and `assignment-2.xlsx`
   (search the repo if not there).
3. Programmatically open both spreadsheets: inspect all worksheets, detect
   merged cells and multi-row headers, preserve worksheet names.
4. Extract every energy source, criterion, and question/binary-response
   field, in original sequence, with exact original wording, punctuation,
   and capitalisation. Do not paraphrase, shorten, or guess.
5. Fail loudly (stop and report) on any row/column that can't be
   interpreted — do not skip silently or invent a mapping.
6. Generate:
   - `/data/assignment-1-manifest.json`
   - `/data/assignment-2-manifest.json`
   - `/data/question-mapping-template.json`
   - `/docs/ASSIGNMENT_QUESTION_APPENDIX.md` (full content of both
     assignments, structured per spec Section 4 template — every question,
     not a sample)

## Definition of done

- Appendix contains every question from both spreadsheets, verified by
  counting rows in source files vs. entries in the manifest.
- A human has reviewed `/docs/ASSIGNMENT_QUESTION_APPENDIX.md` against the
  actual spreadsheets and confirmed no invented/paraphrased wording before
  Phase 2 starts.

## Verification

```bash
# custom extraction verification script comparing manifest counts to
# source spreadsheet row counts — build this as part of Phase 1
npm run verify:extraction
```
