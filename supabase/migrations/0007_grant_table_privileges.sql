-- 0007_grant_table_privileges.sql
-- Every prior migration (0001-0006) created tables and enabled RLS on them,
-- but never issued a base GRANT to anon/authenticated/service_role. RLS
-- policies only filter rows a role is otherwise permitted to touch — without
-- a table-level GRANT, Postgres rejects the query outright with
-- "permission denied for table X" before RLS is ever evaluated. This left
-- every table inaccessible to every Supabase role, including service_role.
--
-- Confirmed directly: `select id from profiles` via the anon-key-scoped
-- `authenticated` role (as used by middleware.ts) and via service_role both
-- returned 42501 permission denied, not an empty/RLS-filtered result.

grant usage on schema public to anon, authenticated, service_role;

-- service_role bypasses RLS (rolbypassrls) but still needs table grants.
grant all on all tables in schema public to service_role;

-- authenticated access is further scoped per-table by the RLS policies
-- already defined in 0001_init.sql and later migrations.
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Roles read tables via SELECT only; no INSERT path for anon (unauthenticated
-- users never reach a query beyond /login, which needs no table access).
grant usage on all sequences in schema public to authenticated, service_role;

-- Ensure tables created by later migrations (Phase 4+) don't silently
-- regress into this same gap.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

alter default privileges in schema public
  grant all on tables to service_role;

alter default privileges in schema public
  grant usage on sequences to authenticated, service_role;
