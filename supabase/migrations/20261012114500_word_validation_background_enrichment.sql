-- Queue reviewable answers for async enrichment without blocking live scoring.
-- Live matches still resolve from local server state first; API outages never
-- become proof that an answer is invalid.

create type public.word_validation_enrichment_status as enum ('pending', 'running', 'succeeded', 'failed');

alter table public.word_validation_cache
  add column if not exists enrichment_status public.word_validation_enrichment_status not null default 'pending',
  add column if not exists enrichment_requested_at timestamptz,
  add column if not exists enrichment_completed_at timestamptz,
  add column if not exists review_notes text;

create table if not exists public.word_validation_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  normalized_answer text not null,
  display_answer text not null,
  status public.word_validation_enrichment_status not null default 'pending',
  attempts integer not null default 0,
  locked_until timestamptz,
  last_error text,
  requested_at timestamptz not null default now(),
  last_requested_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(category) between 1 and 40),
  check (char_length(normalized_answer) between 1 and 120),
  check (char_length(display_answer) between 1 and 120),
  check (attempts >= 0),
  unique (category, normalized_answer)
);

drop trigger if exists set_word_validation_enrichment_jobs_updated_at on public.word_validation_enrichment_jobs;
create trigger set_word_validation_enrichment_jobs_updated_at
before update on public.word_validation_enrichment_jobs
for each row execute function public.set_updated_at();

create index if not exists word_validation_enrichment_jobs_status_idx
  on public.word_validation_enrichment_jobs(status, locked_until, last_requested_at);

alter table public.word_validation_enrichment_jobs enable row level security;
revoke all on public.word_validation_enrichment_jobs from public, anon, authenticated;

create table if not exists public.word_validation_enrichment_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.word_validation_enrichment_jobs(id) on delete set null,
  category text not null,
  normalized_answer text not null,
  provider text not null,
  success boolean not null,
  latency_ms integer,
  verdict public.answer_verdict,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  check (char_length(category) between 1 and 40),
  check (char_length(normalized_answer) between 1 and 120),
  check (char_length(provider) between 1 and 80),
  check (latency_ms is null or latency_ms >= 0)
);

create index if not exists word_validation_enrichment_events_created_idx
  on public.word_validation_enrichment_events(created_at desc, provider, success);

alter table public.word_validation_enrichment_events enable row level security;
revoke all on public.word_validation_enrichment_events from public, anon, authenticated;

create or replace function public.enqueue_word_validation_enrichment(
  p_category text,
  p_normalized_answer text,
  p_display_answer text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  job_id uuid;
begin
  if p_category is null
    or p_normalized_answer is null
    or p_normalized_answer = ''
    or p_display_answer is null
    or btrim(p_display_answer) = '' then
    return null;
  end if;

  insert into public.word_validation_enrichment_jobs (
    category,
    normalized_answer,
    display_answer,
    status,
    last_requested_at
  ) values (
    p_category,
    p_normalized_answer,
    left(btrim(p_display_answer), 120),
    'pending'::public.word_validation_enrichment_status,
    clock_timestamp()
  )
  on conflict (category, normalized_answer)
  do update set
    display_answer = excluded.display_answer,
    last_requested_at = clock_timestamp(),
    status = case
      when public.word_validation_enrichment_jobs.status = 'succeeded' then public.word_validation_enrichment_jobs.status
      when public.word_validation_enrichment_jobs.status = 'running'
        and public.word_validation_enrichment_jobs.locked_until > clock_timestamp()
        then public.word_validation_enrichment_jobs.status
      else 'pending'::public.word_validation_enrichment_status
    end
  returning id into job_id;

  update public.word_validation_cache
  set enrichment_status = case
        when enrichment_status = 'succeeded' then enrichment_status
        else 'pending'::public.word_validation_enrichment_status
      end,
      enrichment_requested_at = coalesce(enrichment_requested_at, clock_timestamp())
  where category = p_category
    and normalized_answer = p_normalized_answer;

  return job_id;
end;
$$;

create or replace function public.claim_word_validation_enrichment_jobs(
  p_limit integer default 10,
  p_lock_seconds integer default 300
)
returns table (
  id uuid,
  category text,
  normalized_answer text,
  display_answer text,
  attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimable as (
    select j.id
    from public.word_validation_enrichment_jobs j
    where j.status in ('pending', 'failed')
      and j.attempts < 5
      and (j.locked_until is null or j.locked_until < clock_timestamp())
    order by j.last_requested_at asc, j.created_at asc
    limit greatest(1, least(coalesce(p_limit, 10), 25))
    for update skip locked
  ),
  updated as (
    update public.word_validation_enrichment_jobs j
    set status = 'running'::public.word_validation_enrichment_status,
        attempts = j.attempts + 1,
        locked_until = clock_timestamp() + make_interval(secs => greatest(30, least(coalesce(p_lock_seconds, 300), 900))),
        last_error = null
    from claimable
    where j.id = claimable.id
    returning j.id, j.category, j.normalized_answer, j.display_answer, j.attempts
  )
  select updated.id, updated.category, updated.normalized_answer, updated.display_answer, updated.attempts
  from updated;
end;
$$;

create or replace function public.complete_word_validation_enrichment(
  p_job_id uuid,
  p_verdict public.answer_verdict,
  p_confidence numeric,
  p_source text,
  p_source_ref text default null,
  p_failure_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.word_validation_enrichment_jobs%rowtype;
  bounded_confidence numeric(4,3);
begin
  if p_verdict not in ('valid'::public.answer_verdict, 'invalid'::public.answer_verdict, 'disputed'::public.answer_verdict) then
    raise exception 'Unsupported enrichment verdict';
  end if;

  select *
  into job_row
  from public.word_validation_enrichment_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Enrichment job not found';
  end if;

  bounded_confidence := greatest(0, least(coalesce(p_confidence, 0.5), 1))::numeric(4,3);

  update public.word_validation_cache
  set verdict = p_verdict,
      confidence = bounded_confidence,
      source = left(coalesce(nullif(btrim(p_source), ''), 'background_enrichment'), 80),
      source_ref = p_source_ref,
      failure_reason = p_failure_reason,
      checked_at = clock_timestamp(),
      enrichment_status = 'succeeded'::public.word_validation_enrichment_status,
      enrichment_completed_at = clock_timestamp(),
      review_notes = case
        when p_verdict = 'disputed'::public.answer_verdict then coalesce(p_failure_reason, review_notes)
        else review_notes
      end
  where category = job_row.category
    and normalized_answer = job_row.normalized_answer;

  update public.word_validation_enrichment_jobs
  set status = 'succeeded'::public.word_validation_enrichment_status,
      locked_until = null,
      last_error = null,
      completed_at = clock_timestamp()
  where id = p_job_id;
end;
$$;

create or replace function public.fail_word_validation_enrichment(
  p_job_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  job_row public.word_validation_enrichment_jobs%rowtype;
begin
  select *
  into job_row
  from public.word_validation_enrichment_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Enrichment job not found';
  end if;

  update public.word_validation_enrichment_jobs
  set status = 'failed'::public.word_validation_enrichment_status,
      locked_until = null,
      last_error = left(coalesce(p_error, 'Unknown enrichment failure'), 500)
  where id = p_job_id;

  update public.word_validation_cache
  set enrichment_status = 'failed'::public.word_validation_enrichment_status,
      review_notes = left(coalesce(p_error, 'Unknown enrichment failure'), 500)
  where category = job_row.category
    and normalized_answer = job_row.normalized_answer
    and verdict = 'disputed'::public.answer_verdict;
end;
$$;

create or replace function public.record_word_validation_enrichment_event(
  p_job_id uuid,
  p_category text,
  p_normalized_answer text,
  p_provider text,
  p_success boolean,
  p_latency_ms integer default null,
  p_verdict public.answer_verdict default null,
  p_error_code text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.word_validation_enrichment_events (
    job_id,
    category,
    normalized_answer,
    provider,
    success,
    latency_ms,
    verdict,
    error_code,
    error_message
  ) values (
    p_job_id,
    p_category,
    p_normalized_answer,
    left(coalesce(nullif(btrim(p_provider), ''), 'unknown'), 80),
    coalesce(p_success, false),
    p_latency_ms,
    p_verdict,
    p_error_code,
    left(p_error_message, 500)
  );
end;
$$;

create or replace function public.validate_live_brawl_answer(
  p_answer_text text,
  p_category text,
  p_letter text
)
returns public.answer_verdict
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_answer text := trim(coalesce(p_answer_text, ''));
  normalized_answer_value text := public.normalize_live_brawl_answer(p_answer_text);
  cached_verdict public.answer_verdict;
begin
  if clean_answer = '' then
    return 'blank'::public.answer_verdict;
  end if;

  if p_letter is not null and upper(left(clean_answer, 1)) <> p_letter then
    return 'invalid'::public.answer_verdict;
  end if;

  select verdict into cached_verdict
  from public.word_validation_cache
  where category = p_category
    and normalized_answer = normalized_answer_value
  order by checked_at desc
  limit 1;

  if cached_verdict is not null then
    update public.word_validation_cache
    set last_used_at = clock_timestamp(),
        usage_count = usage_count + 1
    where category = p_category
      and normalized_answer = normalized_answer_value;

    if cached_verdict = 'disputed'::public.answer_verdict then
      perform public.enqueue_word_validation_enrichment(p_category, normalized_answer_value, clean_answer);
    end if;

    return cached_verdict;
  end if;

  if exists (
    select 1
    from public.bot_word_bank bw
    where bw.category = p_category
      and public.normalize_live_brawl_answer(bw.word) = normalized_answer_value
  ) then
    return 'valid'::public.answer_verdict;
  end if;

  if exists (
    select 1
    from public.bot_word_bank bw
    where bw.category <> p_category
      and public.normalize_live_brawl_answer(bw.word) = normalized_answer_value
  ) then
    return 'invalid'::public.answer_verdict;
  end if;

  insert into public.word_validation_cache (
    category,
    normalized_answer,
    display_answer,
    verdict,
    confidence,
    source,
    failure_reason,
    usage_count,
    enrichment_status,
    enrichment_requested_at
  ) values (
    p_category,
    normalized_answer_value,
    clean_answer,
    'disputed'::public.answer_verdict,
    0.25,
    'server_fallback',
    'No local category match; reviewable until enriched.',
    1,
    'pending'::public.word_validation_enrichment_status,
    clock_timestamp()
  )
  on conflict (category, normalized_answer)
  do update set
    display_answer = excluded.display_answer,
    last_used_at = clock_timestamp(),
    usage_count = public.word_validation_cache.usage_count + 1,
    enrichment_requested_at = coalesce(public.word_validation_cache.enrichment_requested_at, clock_timestamp());

  perform public.enqueue_word_validation_enrichment(p_category, normalized_answer_value, clean_answer);

  return 'disputed'::public.answer_verdict;
end;
$$;

revoke all on function public.claim_word_validation_enrichment_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.complete_word_validation_enrichment(uuid, public.answer_verdict, numeric, text, text, text) from public, anon, authenticated;
revoke all on function public.fail_word_validation_enrichment(uuid, text) from public, anon, authenticated;
revoke all on function public.record_word_validation_enrichment_event(uuid, text, text, text, boolean, integer, public.answer_verdict, text, text) from public, anon, authenticated;

grant execute on function public.enqueue_word_validation_enrichment(text, text, text) to service_role;
grant execute on function public.claim_word_validation_enrichment_jobs(integer, integer) to service_role;
grant execute on function public.complete_word_validation_enrichment(uuid, public.answer_verdict, numeric, text, text, text) to service_role;
grant execute on function public.fail_word_validation_enrichment(uuid, text) to service_role;
grant execute on function public.record_word_validation_enrichment_event(uuid, text, text, text, boolean, integer, public.answer_verdict, text, text) to service_role;
