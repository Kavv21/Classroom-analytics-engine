-- 0014_saved_views_and_dashboards.sql
-- Phase 9: harden the saved_queries / saved_visualisations / dashboards /
-- dashboard_items persistence layer before the query builder starts
-- writing to it.
--
-- Two real defects in the 0001 policies, both of which matter now that
-- these tables become user-writable:
--
-- 1. `dashboard_items_owner` reaches into `dashboards` with a raw
--    correlated subquery — exactly the pattern that caused the 42P17
--    recursion outage fixed in 0008. It does not form a cycle today
--    (`dashboards_owner` is a bare `created_by = auth.uid()`), but the
--    standing rule since 0008 is that no policy reaches another table
--    except through a security-definer helper. Fixed here rather than
--    left as the one exception.
--
-- 2. All four policies authorise on `created_by = auth.uid()` ALONE.
--    Because `FOR ALL` uses the USING expression as the INSERT WITH CHECK
--    when none is given, a professor could save a row whose `class_id`
--    points at a class they do not own. The row itself exposes nothing,
--    but it makes `saved_queries.class_id` an attacker-controlled value —
--    so any export or builder path that trusts the saved definition's
--    class_id becomes a cross-class read. The server actions re-verify
--    ownership independently (defence in depth), but the boundary belongs
--    in the database: these policies now require the class to be the
--    caller's own. A NULL class_id (a personal, class-less query) stays
--    allowed.
--
-- Follows the standing rules: security-definer helpers set
-- search_path = public and schema-qualify every table reference; new
-- relations get explicit GRANTs.

-- ============================================================
-- Helper: does the caller own this dashboard? SECURITY DEFINER so the
-- dashboards lookup inside dashboard_items' policy never re-enters
-- dashboards' own RLS (the 0008 pattern).
-- ============================================================

create or replace function public.owns_dashboard(p_dashboard_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.dashboards d
    where d.id = p_dashboard_id and d.created_by = auth.uid()
  );
$$;

revoke execute on function public.owns_dashboard(uuid) from anon;

-- ============================================================
-- Rewritten ownership policies: creator AND (class is mine or unscoped).
-- USING and WITH CHECK are both stated explicitly rather than relying on
-- USING standing in for WITH CHECK — the INSERT path is the one that
-- needed tightening, so it should be impossible to miss when reading.
-- ============================================================

drop policy if exists saved_queries_owner on public.saved_queries;
create policy saved_queries_owner on public.saved_queries
  for all
  using (
    created_by = auth.uid()
    and (class_id is null or is_professor_of_class(class_id))
  )
  with check (
    created_by = auth.uid()
    and (class_id is null or is_professor_of_class(class_id))
  );

drop policy if exists saved_visualisations_owner on public.saved_visualisations;
create policy saved_visualisations_owner on public.saved_visualisations
  for all
  using (
    created_by = auth.uid()
    and (class_id is null or is_professor_of_class(class_id))
  )
  with check (
    created_by = auth.uid()
    and (class_id is null or is_professor_of_class(class_id))
  );

drop policy if exists dashboards_owner on public.dashboards;
create policy dashboards_owner on public.dashboards
  for all
  using (
    created_by = auth.uid()
    and (class_id is null or is_professor_of_class(class_id))
  )
  with check (
    created_by = auth.uid()
    and (class_id is null or is_professor_of_class(class_id))
  );

drop policy if exists dashboard_items_owner on public.dashboard_items;
create policy dashboard_items_owner on public.dashboard_items
  for all
  using (owns_dashboard(dashboard_id))
  with check (owns_dashboard(dashboard_id));

-- ============================================================
-- Housekeeping the builder relies on.
-- ============================================================

alter table public.saved_visualisations
  add column if not exists description text;

alter table public.dashboard_items
  add column if not exists saved_query_id uuid
    references public.saved_queries(id) on delete cascade;

-- dashboard_items.saved_visualisation_id was NOT NULL in 0001, which
-- prevents an item that references a saved query directly. Relax it and
-- require exactly one of the two references instead.
alter table public.dashboard_items
  alter column saved_visualisation_id drop not null;

alter table public.dashboard_items
  add constraint dashboard_items_one_reference check (
    (saved_visualisation_id is not null and saved_query_id is null)
    or (saved_visualisation_id is null and saved_query_id is not null)
  );

create index if not exists idx_saved_queries_class_creator
  on public.saved_queries(class_id, created_by);
create index if not exists idx_saved_visualisations_class_creator
  on public.saved_visualisations(class_id, created_by);
create index if not exists idx_dashboards_class_creator
  on public.dashboards(class_id, created_by);
create index if not exists idx_dashboard_items_dashboard
  on public.dashboard_items(dashboard_id);

-- 0007's ALTER DEFAULT PRIVILEGES covers tables created later, but these
-- four predate it and are only now becoming user-writable — restate the
-- grants explicitly (a missing grant is a full outage, lesson from 0007).
grant select, insert, update, delete
  on public.saved_queries, public.saved_visualisations,
     public.dashboards, public.dashboard_items
  to authenticated;

grant all
  on public.saved_queries, public.saved_visualisations,
     public.dashboards, public.dashboard_items
  to service_role;
