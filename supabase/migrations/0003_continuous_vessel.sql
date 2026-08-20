-- Continuous Vessel: provider-neutral project health storage.
-- Secrets never belong in these tables. Connector credentials must use the
-- deployment secret store and be referenced only by an opaque connection_id.

create table if not exists public.health_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  app_id uuid not null references public.apps (id) on delete cascade,
  launch_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, app_id)
);

create table if not exists public.project_providers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id uuid not null references public.health_profiles (id) on delete cascade,
  capability text not null check (capability in ('hosting','database','telemetry','uptime','repository','dns')),
  provider_id text not null check (length(provider_id) between 1 and 80),
  connection_id text check (connection_id is null or length(connection_id) <= 200),
  connection_status text not null default 'declared' check (connection_status in ('declared','connected','error','revoked')),
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, capability, provider_id)
);

create table if not exists public.health_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  profile_id uuid not null references public.health_profiles (id) on delete cascade,
  check_id text not null check (length(check_id) between 1 and 80),
  status text not null default 'unknown' check (status in ('green','yellow','red','unknown')),
  source text not null default 'declared' check (source in ('declared','connector','local_scan','manual_evidence')),
  evidence jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  next_check_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists health_profiles_user_idx on public.health_profiles (user_id, updated_at desc);
create index if not exists project_providers_profile_idx on public.project_providers (profile_id, capability);
create index if not exists health_checks_profile_idx on public.health_checks (profile_id, checked_at desc);

alter table public.health_profiles enable row level security;
alter table public.project_providers enable row level security;
alter table public.health_checks enable row level security;

drop policy if exists "health profiles: owners" on public.health_profiles;
create policy "health profiles: owners" on public.health_profiles for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id and exists (select 1 from public.apps a where a.id = app_id and a.user_id = auth.uid()));
drop policy if exists "project providers: owners" on public.project_providers;
create policy "project providers: owners" on public.project_providers for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id and exists (select 1 from public.health_profiles p where p.id = profile_id and p.user_id = auth.uid()));
drop policy if exists "health checks: owner reads" on public.health_checks;
create policy "health checks: owner reads" on public.health_checks for select using (auth.uid() = user_id);
drop policy if exists "health checks: owner inserts" on public.health_checks;
create policy "health checks: owner inserts" on public.health_checks for insert
  with check (auth.uid() = user_id and exists (select 1 from public.health_profiles p where p.id = profile_id and p.user_id = auth.uid()));

drop trigger if exists health_profiles_touch_updated_at on public.health_profiles;
create trigger health_profiles_touch_updated_at before update on public.health_profiles for each row execute function public.touch_updated_at();
drop trigger if exists project_providers_touch_updated_at on public.project_providers;
create trigger project_providers_touch_updated_at before update on public.project_providers for each row execute function public.touch_updated_at();

revoke all on public.health_profiles, public.project_providers, public.health_checks from anon;
grant select, insert, update, delete on public.health_profiles, public.project_providers to authenticated;
grant select, insert, delete on public.health_checks to authenticated;
