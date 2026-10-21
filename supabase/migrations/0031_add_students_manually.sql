-- ============================================================
-- 0031 — Add students to a class by hand, several at once, without a file.
--
-- The CSV/Excel import is the only way onto a roster today. A professor
-- who needs to add one or two students should not have to build a
-- spreadsheet for it. This adds the database half of that: one RPC that
-- takes a handful of typed-in rows and answers PER ROW, so one bad row
-- never blocks the others.
--
-- 1. check_roster_emails gains `pending_other_class_name`.
--    When an email is awaiting first sign-in on ANOTHER class's roster,
--    the professor needs to know what to do next, not just that it failed.
--    The other class's name is returned ONLY when the caller can manage
--    that class too; otherwise it is NULL, and the app says "pending
--    enrollment in another class" without naming anyone else's class.
--    The return type changes, so the function is dropped and recreated;
--    every existing column keeps its name, position and meaning.
--
-- 2. add_students_to_class(p_class_id, p_rows) — security definer, with
--    the same can_manage_class_content gate as commit_roster_import.
--    For each row, under the per-email advisory lock that
--    handle_new_user and provision_roster_entry already take (0030):
--      * classify it through check_roster_emails (one classification,
--        shared with the import),
--      * already in this class / pending here -> ALREADY_ENROLLED
--      * has a profile                         -> class_members row, ENROLLED
--      * pending on another class's roster     -> PENDING_OTHER_CLASS
--      * otherwise                             -> roster_entries row; the
--        0030 trigger provisions it on the spot if they already have an
--        account (PROVISIONED), else PENDING_SIGNUP, or NEEDS_ATTENTION
--        if provisioning failed (already in provisioning_failures).
--    Each row runs in its own sub-transaction: an unexpected error is
--    reported as ERROR for that row (and raised as a WARNING into the
--    Postgres log with full detail) without touching the other rows.
--
--    The role is not a parameter. intended_role and member_role are the
--    literal 'STUDENT'; any role key in p_rows is ignored. TAs keep their
--    own professor-only path, add_class_ta (0028/0030).
--
--    The domain gate is email_domain_allowed (app_config), the same one
--    handle_new_user applies — a row outside it would sit on the roster
--    forever and never be provisioned, so it is refused up front.
--
-- Rollback note: the 0030 emergency rollback was renamed from
-- supabase/rollbacks/0031_rollback_handle_new_user.sql to
-- supabase/rollbacks/rollback_0030_handle_new_user.sql so its number
-- can't be mistaken for this migration. The 0030 header comment still
-- carries the old name; 0030 is applied and is not edited.
-- ============================================================

-- ------------------------------------------------------------
-- 1. check_roster_emails — 0028's version plus pending_other_class_name.
-- ------------------------------------------------------------
drop function if exists public.check_roster_emails(uuid, text[]);

create function public.check_roster_emails(p_class_id uuid, p_emails text[])
returns table (
  email text,
  has_profile boolean,
  profile_id uuid,
  already_class_member boolean,
  pending_this_class boolean,
  pending_other_class boolean,
  pending_other_class_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_class_content(p_class_id) then
    raise exception 'not authorized for this class';
  end if;

  return query
  select
    e.email,
    pr.id is not null,
    pr.id,
    exists (
      select 1 from public.class_members cm
      where cm.class_id = p_class_id and cm.user_id = pr.id
    ),
    exists (
      select 1 from public.roster_entries re
      where re.email = e.email and re.provisioned = false and re.class_id = p_class_id
    ),
    exists (
      select 1 from public.roster_entries re
      where re.email = e.email and re.provisioned = false
        and re.class_id is distinct from p_class_id
    ),
    -- Named only for a class the caller also manages. roster_entries.email
    -- is unique, so there is at most one such row.
    (
      select c.name
      from public.roster_entries re
      join public.classes c on c.id = re.class_id
      where re.email = e.email and re.provisioned = false
        and re.class_id <> p_class_id
        and public.can_manage_class_content(re.class_id)
    )
  from unnest(p_emails) as e(email)
  left join public.profiles pr on pr.email = e.email;
end;
$$;

revoke execute on function public.check_roster_emails(uuid, text[]) from public, anon;
grant execute on function public.check_roster_emails(uuid, text[]) to authenticated;

comment on function public.check_roster_emails(uuid, text[]) is
  'Staff of p_class_id only. Per email: has a profile (and its id), already a member of this class, pending first sign-in on this class, pending on another class — and that other class''s name ONLY when the caller can manage it too, else NULL. Never returns any other profile field.';

-- ------------------------------------------------------------
-- 2. add_students_to_class
--
-- p_rows: [{ key, email, fullName, rollNumber?, programme?,
--            yearOfStudy?, section? }, ...]   (at most 50)
-- Returns: [{ key, email, outcome, otherClassName?, errorCode? }, ...]
--   in p_rows order. outcome is one of:
--   ENROLLED | PROVISIONED | PENDING_SIGNUP | ALREADY_ENROLLED |
--   PENDING_OTHER_CLASS | NEEDS_ATTENTION | INVALID | ERROR
-- Raises only for an unauthorised caller or a malformed p_rows.
-- ------------------------------------------------------------
create or replace function public.add_students_to_class(p_class_id uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_data jsonb;
  v_results jsonb := '[]'::jsonb;
  v_key text;
  v_email text;
  v_name text;
  v_check record;
  v_roster_id uuid;
  v_provisioned boolean;
  v_failure record;
  v_outcome text;
  v_state text;
  v_message text;
begin
  if not public.can_manage_class_content(p_class_id) then
    raise exception 'not authorized to add students to this class';
  end if;

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'p_rows must be a JSON array';
  end if;

  if jsonb_array_length(p_rows) > 50 then
    raise exception 'at most 50 students can be added at once (got %)', jsonb_array_length(p_rows);
  end if;

  for row_data in select * from jsonb_array_elements(p_rows)
  loop
    v_key := row_data->>'key';
    v_email := lower(trim(coalesce(row_data->>'email', '')));
    v_name := nullif(trim(coalesce(row_data->>'fullName', '')), '');

    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_results := v_results || jsonb_build_object(
        'key', v_key, 'email', v_email, 'outcome', 'INVALID', 'errorCode', 'EMAIL_INVALID');
      continue;
    end if;
    if v_name is null then
      v_results := v_results || jsonb_build_object(
        'key', v_key, 'email', v_email, 'outcome', 'INVALID', 'errorCode', 'NAME_REQUIRED');
      continue;
    end if;
    if not public.email_domain_allowed(v_email) then
      v_results := v_results || jsonb_build_object(
        'key', v_key, 'email', v_email, 'outcome', 'INVALID', 'errorCode', 'DOMAIN_NOT_ALLOWED');
      continue;
    end if;

    begin
      -- Same lock as handle_new_user / provision_roster_entry: a first
      -- sign-in for this email waits for this row, and vice versa.
      perform pg_advisory_xact_lock(hashtext(v_email));

      select * into v_check
      from public.check_roster_emails(p_class_id, array[v_email]);

      if v_check.already_class_member or v_check.pending_this_class then
        v_outcome := 'ALREADY_ENROLLED';

      elsif v_check.has_profile then
        insert into public.class_members (class_id, user_id, member_role, status)
        values (p_class_id, v_check.profile_id, 'STUDENT', 'ACTIVE')
        on conflict (class_id, user_id) do nothing;
        v_outcome := 'ENROLLED';

      elsif v_check.pending_other_class then
        v_results := v_results || jsonb_build_object(
          'key', v_key, 'email', v_email, 'outcome', 'PENDING_OTHER_CLASS',
          'otherClassName', v_check.pending_other_class_name);
        continue;

      else
        insert into public.roster_entries (
          email, intended_role, class_id, roll_number, full_name, programme,
          year_of_study, section, created_by
        ) values (
          v_email,
          'STUDENT',
          p_class_id,
          nullif(trim(coalesce(row_data->>'rollNumber', '')), ''),
          v_name,
          nullif(trim(coalesce(row_data->>'programme', '')), ''),
          nullif(trim(coalesce(row_data->>'yearOfStudy', '')), ''),
          nullif(trim(coalesce(row_data->>'section', '')), ''),
          auth.uid()
        ) returning id into v_roster_id;

        -- The 0030 AFTER INSERT trigger has already run. Read back what it did.
        select re.provisioned into v_provisioned
        from public.roster_entries re where re.id = v_roster_id;

        if v_provisioned then
          v_outcome := 'PROVISIONED';
        else
          select f.error_code into v_failure
          from public.provisioning_failures f
          where f.roster_entry_id = v_roster_id
          order by f.created_at desc
          limit 1;

          if v_failure.error_code is not null then
            v_results := v_results || jsonb_build_object(
              'key', v_key, 'email', v_email, 'outcome', 'NEEDS_ATTENTION',
              'errorCode', v_failure.error_code);
            continue;
          end if;
          v_outcome := 'PENDING_SIGNUP';
        end if;
      end if;

      if v_outcome <> 'ALREADY_ENROLLED' then
        perform public.log_audit_event(
          'ROSTER_STUDENT_ADDED', 'class', p_class_id,
          jsonb_build_object('email', v_email, 'outcome', v_outcome, 'source', 'MANUAL')
        );
      end if;

      v_results := v_results || jsonb_build_object(
        'key', v_key, 'email', v_email, 'outcome', v_outcome);
    exception
    when unique_violation then
      -- roster_entries.email is taken by a row check_roster_emails does not
      -- count as pending (provisioned, yet no profile). Nothing was added;
      -- an administrator has to untangle that account.
      get stacked diagnostics v_message = message_text;
      raise warning 'add_students_to_class: class % row % (%) conflicts with an existing roster entry: %',
        p_class_id, v_key, v_email, v_message;
      v_results := v_results || jsonb_build_object(
        'key', v_key, 'email', v_email, 'outcome', 'ERROR',
        'errorCode', 'ROSTER_EMAIL_CONFLICT', 'errorMessage', v_message);
    when others then
      get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
      raise warning 'add_students_to_class: class % row % (%) failed: [%] %',
        p_class_id, v_key, v_email, v_state, v_message;
      v_results := v_results || jsonb_build_object(
        'key', v_key, 'email', v_email, 'outcome', 'ERROR',
        'errorCode', v_state, 'errorMessage', v_message);
    end;
  end loop;

  return v_results;
end;
$$;

revoke execute on function public.add_students_to_class(uuid, jsonb) from public, anon;
grant execute on function public.add_students_to_class(uuid, jsonb) to authenticated;

comment on function public.add_students_to_class(uuid, jsonb) is
  'Staff of p_class_id only (can_manage_class_content). Adds up to 50 typed-in students, one sub-transaction per row, and returns one outcome per row: ENROLLED (existing account, added to class), PROVISIONED (account existed, set up now), PENDING_SIGNUP, ALREADY_ENROLLED, PENDING_OTHER_CLASS (+ otherClassName only if the caller manages that class), NEEDS_ATTENTION (+ provisioning errorCode), INVALID (+ errorCode) or ERROR. Role is always STUDENT.';

notify pgrst, 'reload schema';
