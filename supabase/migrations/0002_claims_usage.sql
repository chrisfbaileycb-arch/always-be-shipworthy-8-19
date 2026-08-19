-- Claims module — usage accounting and rate limiting.
--
-- The claims endpoint spends money on every call. An authenticated endpoint
-- that proxies a paid model with no ceiling is a billing incident waiting for
-- one motivated user, so the limit lives in the database where it is atomic and
-- survives Edge Function instances being recycled — an in-memory counter in the
-- function would reset on every cold start and be trivially defeated.

create table if not exists public.claims_usage (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- Recorded for cost attribution. No listing text is stored here: the point of
  -- this table is counting, and keeping copy out of it keeps the blast radius
  -- of a mistake small.
  input_chars integer not null default 0 check (input_chars >= 0),
  claims_found smallint not null default 0 check (claims_found >= 0),
  model       text
);

create index if not exists claims_usage_user_time_idx
  on public.claims_usage (user_id, created_at desc);

alter table public.claims_usage enable row level security;

-- Users may read their own usage — it is their spend. Nobody writes through the
-- API: rows are inserted only by the security-definer function below, so a
-- client cannot forge or delete its own history to reset a limit.
drop policy if exists "claims_usage: owner reads" on public.claims_usage;
create policy "claims_usage: owner reads" on public.claims_usage
  for select using (auth.uid() = user_id);

revoke all on public.claims_usage from anon, authenticated;
grant select on public.claims_usage to authenticated;

-- ─── Atomic check-and-record ─────────────────────────────────────────────────
--
-- SECURITY DEFINER so it can insert into a table the caller cannot write to
-- directly. It takes no user id: the caller is always auth.uid(), so a client
-- cannot spend somebody else's quota or attribute its spend to another account.
--
-- search_path is pinned empty and every reference is schema-qualified, which is
-- the standard hardening for a definer function — without it, a caller-controlled
-- search_path could shadow a referenced object.

create or replace function public.claim_rate_limit(
  p_hourly_limit integer default 20,
  p_daily_limit  integer default 100
)
returns table (allowed boolean, used_hour integer, used_day integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_hour integer;
  v_day  integer;
  v_oldest timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select count(*) into v_hour
    from public.claims_usage u
   where u.user_id = v_user and u.created_at > now() - interval '1 hour';

  select count(*) into v_day
    from public.claims_usage u
   where u.user_id = v_user and u.created_at > now() - interval '1 day';

  if v_hour >= p_hourly_limit or v_day >= p_daily_limit then
    select min(u.created_at) into v_oldest
      from public.claims_usage u
     where u.user_id = v_user
       and u.created_at > now() - (case when v_hour >= p_hourly_limit
                                        then interval '1 hour'
                                        else interval '1 day' end);

    return query select
      false,
      v_hour,
      v_day,
      greatest(1, ceil(extract(epoch from (
        v_oldest + (case when v_hour >= p_hourly_limit
                         then interval '1 hour'
                         else interval '1 day' end) - now()
      )))::integer);
    return;
  end if;

  return query select true, v_hour, v_day, 0;
end;
$$;

revoke all on function public.claim_rate_limit(integer, integer) from public, anon;
grant execute on function public.claim_rate_limit(integer, integer) to authenticated;

-- Recorded only after a call actually succeeds, so a provider outage does not
-- burn the user's quota.
create or replace function public.record_claim_usage(
  p_input_chars integer,
  p_claims_found integer,
  p_model text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.claims_usage (user_id, input_chars, claims_found, model)
  values (v_user, greatest(0, p_input_chars), greatest(0, p_claims_found), p_model);
end;
$$;

revoke all on function public.record_claim_usage(integer, integer, text) from public, anon;
grant execute on function public.record_claim_usage(integer, integer, text) to authenticated;
