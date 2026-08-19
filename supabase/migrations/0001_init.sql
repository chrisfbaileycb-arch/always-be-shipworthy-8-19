-- Shipworthy — initial schema.
--
-- SECURITY MODEL
--
-- The anon key is published in the browser bundle. It is safe there only because
-- row-level security, not key secrecy, is what protects this data. Every table
-- below therefore:
--
--   1. enables RLS (which denies everything by default),
--   2. carries a non-null user_id defaulting to auth.uid(),
--   3. grants access exclusively through policies scoped to auth.uid(),
--   4. uses WITH CHECK on writes so a client cannot insert or update a row
--      claiming to belong to somebody else.
--
-- If you add a table, it needs all four. A table with RLS left off is readable
-- and writable by anyone holding the anon key — which is everyone.
--
-- PRIVACY NOTE
--
-- Saved reports contain evidence excerpts quoted from the user's own config and
-- listing copy. Persistence is therefore opt-in: scans run locally and are only
-- written here when the user explicitly saves one. Detected credentials are
-- masked by the scanner before a finding is ever constructed, so a stored
-- excerpt holds a fingerprint rather than a usable secret — but the safest
-- posture is still that the user chooses.

-- ─── apps ────────────────────────────────────────────────────────────────────

create table if not exists public.apps (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 200),
  platform      text not null default 'unknown'
                  check (platform in ('android', 'ios', 'web', 'unknown')),
  notes         text check (notes is null or length(notes) <= 4000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists apps_user_id_created_idx
  on public.apps (user_id, created_at desc);

alter table public.apps enable row level security;

drop policy if exists "apps: owner reads" on public.apps;
create policy "apps: owner reads" on public.apps
  for select using (auth.uid() = user_id);

drop policy if exists "apps: owner inserts" on public.apps;
create policy "apps: owner inserts" on public.apps
  for insert with check (auth.uid() = user_id);

drop policy if exists "apps: owner updates" on public.apps;
create policy "apps: owner updates" on public.apps
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "apps: owner deletes" on public.apps;
create policy "apps: owner deletes" on public.apps
  for delete using (auth.uid() = user_id);

-- ─── reports ─────────────────────────────────────────────────────────────────
--
-- `modules` holds the full ModuleResult[] as JSONB, so the stored shape is
-- exactly what the scanner produced and nothing is lost in translation.
--
-- The summary columns beside it are denormalised for listing and filtering.
-- Note that `overall` is NULLABLE and that is load-bearing: a report with
-- partial module coverage genuinely has no overall score, and the column must be
-- able to say so rather than defaulting to a number. A NOT NULL DEFAULT 0 here
-- would reintroduce the false-pass bug at the database layer.

create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users (id) on delete cascade,
  app_id           uuid references public.apps (id) on delete cascade,

  app_name         text not null,
  modules          jsonb not null,

  -- Summary, denormalised for cheap listing.
  overall          smallint check (overall is null or overall between 0 and 100),
  coverage         real not null default 0 check (coverage between 0 and 1),
  assessed_count   smallint not null default 0 check (assessed_count >= 0),
  checks_run       integer not null default 0 check (checks_run >= 0),
  critical_count   integer not null default 0 check (critical_count >= 0),
  warn_count       integer not null default 0 check (warn_count >= 0),
  info_count       integer not null default 0 check (info_count >= 0),

  -- Which registry revision produced this, so an old report can be read honestly.
  rules_as_of      date not null,

  created_at       timestamptz not null default now()
);

create index if not exists reports_user_created_idx
  on public.reports (user_id, created_at desc);

create index if not exists reports_app_created_idx
  on public.reports (app_id, created_at desc);

alter table public.reports enable row level security;

drop policy if exists "reports: owner reads" on public.reports;
create policy "reports: owner reads" on public.reports
  for select using (auth.uid() = user_id);

drop policy if exists "reports: owner inserts" on public.reports;
create policy "reports: owner inserts" on public.reports
  for insert with check (
    auth.uid() = user_id
    -- An app_id may only be attached if the caller owns that app.
    and (
      app_id is null
      or exists (
        select 1 from public.apps a
        where a.id = reports.app_id and a.user_id = auth.uid()
      )
    )
  );

-- Reports are an audit trail: no UPDATE policy exists, so they are immutable
-- once written. Rescanning creates a new row rather than rewriting history.

drop policy if exists "reports: owner deletes" on public.reports;
create policy "reports: owner deletes" on public.reports
  for delete using (auth.uid() = user_id);

-- ─── updated_at maintenance ──────────────────────────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists apps_touch_updated_at on public.apps;
create trigger apps_touch_updated_at
  before update on public.apps
  for each row execute function public.touch_updated_at();

-- ─── least privilege ─────────────────────────────────────────────────────────
--
-- Supabase grants the anon and authenticated roles broad table privileges by
-- default and relies on RLS to constrain them. Narrow that explicitly: signed-out
-- visitors get nothing at all, and signed-in users get only the verbs the
-- policies above actually contemplate. There is no UPDATE grant on reports,
-- matching the absent update policy.

revoke all on public.apps    from anon;
revoke all on public.reports from anon;

grant select, insert, update, delete on public.apps    to authenticated;
grant select, insert,         delete on public.reports to authenticated;
