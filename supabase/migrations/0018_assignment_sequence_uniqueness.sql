-- 0018_assignment_sequence_uniqueness.sql
-- Root-cause fix: nothing stopped two assignments in one class from
-- sharing a sequence_number.
--
-- WHY THIS IS NOT COSMETIC
-- `assignments.sequence_number` is not a display field. It is the value the
-- mapping engine derives sides from, in create_question_mapping (0011):
--
--     mapping_side = case a.sequence_number when 1 then 1 else 2 end
--
-- and the value validate_mapping_questions (0011) resolves "the class's
-- sequence-1 assignment" and "the class's sequence-2 assignment" against.
-- It is also the pivot for energy_source_assignment_change (0017).
--
-- So when a class ends up with two sequence-1 assignments and no sequence-2
-- assignment, the consequences cascade:
--   * every attempt to create a one-to-one mapping is REJECTED, because no
--     question can be resolved to a sequence-2 assignment;
--   * any mapping that did get created has both members on side 1, so
--     response_transitions_live sees a1_count = 2 / a2_count = 0, marks the
--     pair NOT_COMPARABLE, and the transition engine yields nothing — the
--     entire analytics surface silently reports "no data" rather than an
--     error;
--   * per-assignment aggregates SUM the two sequence-1 assignments
--     together, so Assignment 1 totals are inflated by a duplicate.
--
-- The `int not null default 1` column default is what makes this easy to
-- hit: create two assignments, touch nothing, and both are sequence 1.
--
-- ARCHIVED IS EXCLUDED from the constraint on purpose. Cleaning up a
-- duplicate assignment that already has responses means archiving it, not
-- deleting it (never destroy a class's responses). An archived duplicate
-- must therefore be allowed to keep whatever sequence number it had, so the
-- uniqueness rule applies only to assignments still in play.
--
-- NOTE for the caller: this migration FAILS LOUDLY, with the offending rows
-- named, if the data already violates the rule. That is deliberate — this
-- is not something a migration may guess its way out of, because picking
-- which of two assignments is "the second one" is a decision only the
-- professor can make. Repair first (scripts/bulk-create-mappings.ts
-- --fix-sequence reports and can apply the repair), then re-run.

do $$
declare
  v_conflicts text;
begin
  select string_agg(
           format('class %s: sequence %s used by %s', class_id, sequence_number, titles),
           E'\n  '
         )
    into v_conflicts
  from (
    select
      a.class_id,
      a.sequence_number,
      string_agg(format('%L (%s)', a.title, a.id), ', ' order by a.created_at) as titles
    from public.assignments a
    where a.status <> 'ARCHIVED'
    group by a.class_id, a.sequence_number
    having count(*) > 1
  ) conflicts;

  if v_conflicts is not null then
    raise exception E'Cannot add the assignment sequence-number uniqueness rule — these classes already have duplicates:\n  %\n\nResolve them first (archive or renumber the duplicate), then re-run this migration. See scripts/bulk-create-mappings.ts --fix-sequence.', v_conflicts;
  end if;
end;
$$;

-- Partial unique index: one assignment per (class, sequence number) among
-- assignments that are still in play.
create unique index if not exists assignments_class_sequence_unique
  on public.assignments (class_id, sequence_number)
  where status <> 'ARCHIVED';

comment on index public.assignments_class_sequence_unique is
  'One live assignment per (class_id, sequence_number). sequence_number drives mapping side derivation in create_question_mapping and the A1/A2 pivot in energy_source_assignment_change, so a collision silently disables the transition engine. ARCHIVED excluded so a superseded duplicate can be archived rather than deleted.';
