-- 0001_init.sql
-- Classroom Opinion Analytics Platform — initial schema.
-- Reference: /docs/DATABASE_SCHEMA.md. Keep both in sync.

create extension if not exists "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================

create type user_role as enum ('ADMIN', 'PROFESSOR', 'STUDENT');

create type assignment_stage as enum
  ('PRE_INSTRUCTION', 'POST_INSTRUCTION', 'FOLLOW_UP', 'OTHER');

create type assignment_status as enum
  ('DRAFT', 'READY', 'OPEN', 'CLOSED', 'ARCHIVED');

create type attempt_state as enum
  ('NOT_STARTED', 'DRAFT', 'SUBMITTED', 'REOPENED', 'RESUBMITTED');

create type mapping_type as enum (
  'EXACT_ONE_TO_ONE', 'CONCEPTUAL_ONE_TO_ONE', 'ONE_TO_MANY',
  'MANY_TO_ONE', 'GROUPED_CONCEPT', 'NOT_COMPARABLE', 'UNMAPPED'
);

create type transition_state as enum ('S00', 'S01', 'S10', 'S11');

create type data_quality_status as enum (
  'MISSING_A1', 'MISSING_A2', 'MISSING_BOTH', 'NOT_COMPARABLE'
);

-- ============================================================
-- CORE TABLES
-- ============================================================

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  role user_role not null default 'STUDENT',
  student_identifier text,
  roll_number text,
  programme text,
  year_of_study text,
  section text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table classes (
  id uuid primary key default gen_random_uuid(),
  professor_id uuid not null references profiles(id),
  name text not null,
  course_name text,
  academic_year text,
  semester text,
  section text,
  class_code text unique,
  start_date date,
  end_date date,
  status text not null default 'ACTIVE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table class_members (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  member_role user_role not null default 'STUDENT',
  status text not null default 'ACTIVE',
  joined_at timestamptz not null default now(),
  unique (class_id, user_id)
);

create table assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  title text not null,
  description text,
  instructions text,
  assignment_stage assignment_stage not null default 'OTHER',
  sequence_number int not null default 1,
  open_at timestamptz,
  close_at timestamptz,
  status assignment_status not null default 'DRAFT',
  allow_draft_editing boolean not null default true,
  allow_resubmission boolean not null default false,
  response_zero_label text not null default 'No (0)',
  response_one_label text not null default 'Yes (1)',
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  external_question_code text not null, -- e.g. A1-001
  original_worksheet text,
  original_row_reference text,
  original_column_reference text,
  question_text text not null,
  energy_source text,
  criterion text,
  concept text,
  response_zero_label text not null,
  response_one_label text not null,
  display_order int not null,
  is_active boolean not null default true,
  raw_source_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, external_question_code)
);

create table question_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  value smallint not null check (value in (0, 1)),
  label text not null
);

create table assignment_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  state attempt_state not null default 'NOT_STARTED',
  started_at timestamptz,
  last_saved_at timestamptz,
  submitted_at timestamptz,
  reopened_at timestamptz,
  reopened_by uuid references profiles(id),
  submission_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, student_id)
);

create table responses (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references assignment_attempts(id) on delete cascade,
  assignment_id uuid not null references assignments(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  response_value smallint check (response_value in (0, 1) or response_value is null),
  is_final boolean not null default false,
  first_saved_at timestamptz not null default now(),
  last_saved_at timestamptz not null default now(),
  submitted_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (attempt_id, question_id)
);

create table question_mappings (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  assignment_1_question_ids uuid[] not null default '{}',
  assignment_2_question_ids uuid[] not null default '{}',
  mapping_name text not null,
  common_concept text,
  energy_source text,
  criterion text,
  mapping_type mapping_type not null default 'UNMAPPED',
  comparison_method text,
  professor_notes text,
  mapping_status text not null default 'DRAFT',
  professor_approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table question_mapping_members (
  id uuid primary key default gen_random_uuid(),
  mapping_id uuid not null references question_mappings(id) on delete cascade,
  assignment_id uuid not null references assignments(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  mapping_side smallint not null check (mapping_side in (1, 2)), -- 1 = A1 side, 2 = A2 side
  weight numeric,
  created_at timestamptz not null default now()
);

create table response_transitions (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  mapping_id uuid not null references question_mappings(id) on delete cascade,
  assignment_1_value smallint check (assignment_1_value in (0, 1) or assignment_1_value is null),
  assignment_2_value smallint check (assignment_2_value in (0, 1) or assignment_2_value is null),
  transition_state transition_state,
  data_quality_status data_quality_status,
  calculated_at timestamptz not null default now(),
  unique (student_id, mapping_id)
);

create table saved_queries (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references classes(id) on delete cascade,
  created_by uuid not null references profiles(id),
  name text not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table saved_visualisations (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references classes(id) on delete cascade,
  created_by uuid not null references profiles(id),
  name text not null,
  chart_type text not null,
  query_definition jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dashboards (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references classes(id) on delete cascade,
  created_by uuid not null references profiles(id),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dashboard_items (
  id uuid primary key default gen_random_uuid(),
  dashboard_id uuid not null references dashboards(id) on delete cascade,
  saved_visualisation_id uuid not null references saved_visualisations(id) on delete cascade,
  position int not null default 0
);

create table imports (
  id uuid primary key default gen_random_uuid(),
  class_id uuid references classes(id) on delete cascade,
  assignment_id uuid references assignments(id) on delete cascade,
  import_type text not null, -- 'ROSTER' | 'ASSIGNMENT'
  source_filename text not null,
  source_checksum text not null,
  status text not null default 'PENDING',
  imported_by uuid not null references profiles(id),
  summary jsonb,
  created_at timestamptz not null default now()
);

create table import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references imports(id) on delete cascade,
  row_number int not null,
  raw_data jsonb not null,
  status text not null default 'PENDING', -- 'IMPORTED' | 'REJECTED' | 'PENDING'
  error_message text
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================
-- INDEXES
-- ============================================================

create index idx_class_members_class on class_members(class_id);
create index idx_class_members_user on class_members(user_id);
create index idx_assignments_class on assignments(class_id);
create index idx_questions_assignment on questions(assignment_id);
create index idx_attempts_assignment on assignment_attempts(assignment_id);
create index idx_attempts_student on assignment_attempts(student_id);
create index idx_responses_attempt on responses(attempt_id);
create index idx_responses_question on responses(question_id);
create index idx_responses_student on responses(student_id);
create index idx_mappings_class on question_mappings(class_id);
create index idx_mapping_members_mapping on question_mapping_members(mapping_id);
create index idx_transitions_mapping on response_transitions(mapping_id);
create index idx_transitions_student on response_transitions(student_id);
create index idx_transitions_class on response_transitions(class_id);

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================

alter table profiles enable row level security;
alter table classes enable row level security;
alter table class_members enable row level security;
alter table assignments enable row level security;
alter table questions enable row level security;
alter table assignment_attempts enable row level security;
alter table responses enable row level security;
alter table question_mappings enable row level security;
alter table question_mapping_members enable row level security;
alter table response_transitions enable row level security;
alter table saved_queries enable row level security;
alter table saved_visualisations enable row level security;
alter table dashboards enable row level security;
alter table dashboard_items enable row level security;
alter table imports enable row level security;
alter table import_rows enable row level security;
alter table audit_logs enable row level security;

-- Helper: current user's role, read from profiles (avoids recursive RLS by
-- using security definer)
create or replace function current_user_role()
returns user_role
language sql security definer stable
as $$
  select role from profiles where id = auth.uid()
$$;

-- profiles: read own; professors/admins read profiles in their classes
create policy profiles_select_own on profiles
  for select using (id = auth.uid());

create policy profiles_admin_all on profiles
  for all using (current_user_role() = 'ADMIN');

-- classes: professor manages own; students read classes they belong to
create policy classes_professor_manage on classes
  for all using (professor_id = auth.uid());

create policy classes_member_select on classes
  for select using (
    exists (
      select 1 from class_members cm
      where cm.class_id = classes.id and cm.user_id = auth.uid()
    )
  );

-- class_members: professor manages own class's members; student reads own row
create policy class_members_professor_manage on class_members
  for all using (
    exists (
      select 1 from classes c
      where c.id = class_members.class_id and c.professor_id = auth.uid()
    )
  );

create policy class_members_self_select on class_members
  for select using (user_id = auth.uid());

-- assignments: professor manages own class's assignments;
-- students read only OPEN/CLOSED assignments for classes they belong to
create policy assignments_professor_manage on assignments
  for all using (
    exists (
      select 1 from classes c
      where c.id = assignments.class_id and c.professor_id = auth.uid()
    )
  );

create policy assignments_student_select on assignments
  for select using (
    status in ('OPEN', 'CLOSED')
    and exists (
      select 1 from class_members cm
      where cm.class_id = assignments.class_id and cm.user_id = auth.uid()
    )
  );

-- questions: follow assignment visibility
create policy questions_professor_manage on questions
  for all using (
    exists (
      select 1 from assignments a join classes c on c.id = a.class_id
      where a.id = questions.assignment_id and c.professor_id = auth.uid()
    )
  );

create policy questions_student_select on questions
  for select using (
    exists (
      select 1 from assignments a join class_members cm on cm.class_id = a.class_id
      where a.id = questions.assignment_id
        and a.status in ('OPEN', 'CLOSED')
        and cm.user_id = auth.uid()
    )
  );

-- assignment_attempts: student owns their own attempt; professor reads/manages
-- attempts within their classes
create policy attempts_student_own on assignment_attempts
  for all using (student_id = auth.uid())
  with check (student_id = auth.uid());

create policy attempts_professor_manage on assignment_attempts
  for all using (
    exists (
      select 1 from assignments a join classes c on c.id = a.class_id
      where a.id = assignment_attempts.assignment_id and c.professor_id = auth.uid()
    )
  );

-- responses: student owns their own draft/submitted responses;
-- professor reads (not writes) responses within their classes
create policy responses_student_own on responses
  for all using (student_id = auth.uid())
  with check (student_id = auth.uid());

create policy responses_professor_select on responses
  for select using (
    exists (
      select 1 from assignments a join classes c on c.id = a.class_id
      where a.id = responses.assignment_id and c.professor_id = auth.uid()
    )
  );

-- question_mappings / mapping_members: professor-only (their own classes)
create policy mappings_professor_manage on question_mappings
  for all using (
    exists (
      select 1 from classes c
      where c.id = question_mappings.class_id and c.professor_id = auth.uid()
    )
  );

create policy mapping_members_professor_manage on question_mapping_members
  for all using (
    exists (
      select 1 from question_mappings qm join classes c on c.id = qm.class_id
      where qm.id = question_mapping_members.mapping_id and c.professor_id = auth.uid()
    )
  );

-- response_transitions: professor reads their class's transitions;
-- students never read this table directly (no per-student comparison view
-- in v1 — revisit deliberately if that becomes a requirement)
create policy transitions_professor_select on response_transitions
  for select using (
    exists (
      select 1 from classes c
      where c.id = response_transitions.class_id and c.professor_id = auth.uid()
    )
  );

-- saved_queries / saved_visualisations / dashboards / dashboard_items:
-- creator + professor of the associated class
create policy saved_queries_owner on saved_queries
  for all using (created_by = auth.uid());

create policy saved_visualisations_owner on saved_visualisations
  for all using (created_by = auth.uid());

create policy dashboards_owner on dashboards
  for all using (created_by = auth.uid());

create policy dashboard_items_owner on dashboard_items
  for all using (
    exists (
      select 1 from dashboards d where d.id = dashboard_items.dashboard_id
        and d.created_by = auth.uid()
    )
  );

-- imports / import_rows: professor of the associated class
create policy imports_professor on imports
  for all using (
    class_id is null or exists (
      select 1 from classes c where c.id = imports.class_id and c.professor_id = auth.uid()
    )
  );

create policy import_rows_professor on import_rows
  for all using (
    exists (
      select 1 from imports i
      left join classes c on c.id = i.class_id
      where i.id = import_rows.import_id
        and (i.class_id is null or c.professor_id = auth.uid())
    )
  );

-- audit_logs: admin only
create policy audit_logs_admin on audit_logs
  for select using (current_user_role() = 'ADMIN');

-- NOTE: admin-level policies above are intentionally narrow. Extend with
-- explicit ADMIN-role policies per table as Section 7's admin capabilities
-- are implemented — do not widen student/professor policies to cover admin
-- needs.
