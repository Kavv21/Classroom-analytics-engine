# How to use this scaffold

> **Historical.** This describes how the project was *built* — the
> phase-by-phase, two-worktree Claude Code workflow that produced the app.
> The build is finished and deployed; all ten phases are done. Nothing here
> is a current instruction. For how to run, operate or extend the app as it
> exists, read `README.md`, then `docs/HOW_IT_WORKS.md` and
> `docs/MAINTAINER_GUIDE.md`.

This is the Claude Code context/planning layer for the Classroom Opinion
Analytics Platform — not the app itself. Drop it into an empty repo (or
merge into an existing one), then let Claude Code build against it.

## File map

```
CLAUDE.md                         # read every session — stack, rules, commands
docs/
  DATABASE_SCHEMA.md              # schema reference, kept in sync with migrations
  ANALYTICS_DEFINITIONS.md        # formulas — copy exactly, never reimplement
  EXCLUDED_FEATURES.md            # hard boundary, never build these
.claude/
  rules/db.md                     # auto-loaded when touching db/migrations
  rules/analytics.md              # auto-loaded when touching analytics code
  agents/backend-owner.md         # subagent: schema/API/analytics, worktree-isolated
  agents/frontend-owner.md        # subagent: UI/charts, worktree-isolated
plan/
  MASTER_SPEC.md                  # full original spec, verbatim, for reference
  phase-1-...  through
  phase-10-...                    # one file per build phase, in order
```

## Step by step

1. Put `source-assignments/assignment-1.xlsx` and `assignment-2.xlsx` in the
   repo root before starting.
2. Start Claude Code in the repo root. It auto-loads `CLAUDE.md`.
3. Ask it to work `plan/phase-1-foundation-inspection.md`. Review the
   generated question appendix against the real spreadsheets yourself
   before moving on — this is the one phase worth reading closely by hand.
4. Phase 2 (`plan/phase-2-foundation-schema-auth.md`) next, single agent.
   This freezes the schema/type contract.
5. From Phase 3 onward, split into two worktrees if you want the speed-up:

   ```bash
   # from the repo root, after Phase 2 is merged to main
   claude --worktree backend-work
   claude --worktree frontend-work
   ```

   In `backend-work`, tell Claude Code to act as the `backend-owner` agent
   and work the backend tasks in the current phase file. In
   `frontend-work`, same for `frontend-owner`. Both should read the same
   phase file — it already splits tasks by "Agent: backend-owner" /
   "frontend-owner" sections.

6. After each phase, merge both worktrees back to main, run the phase's
   verification commands on the merged result, resolve any contract drift,
   then move to the next phase file. Don't let the two worktrees drift more
   than one phase apart.
7. Phase 10 is single-agent again — it needs the fully merged tree.

## Why not parallelize everything

Phases 1, 2, and 10 are sequential on purpose: Phase 1 produces the only
source of truth for question wording, Phase 2 produces the schema/type
contract everything else writes against, and Phase 10 needs the whole tree
to test and ship. Splitting those would just create rework. Phases 3-9 are
where two agents genuinely save time, because backend and frontend work
against a contract that's already frozen.
