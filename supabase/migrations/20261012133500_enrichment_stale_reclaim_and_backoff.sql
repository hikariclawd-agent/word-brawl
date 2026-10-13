-- Make background validation enrichment resilient to worker crashes and provider
-- failures. Expired running jobs can be reclaimed, while failed jobs wait on
-- bounded exponential backoff before another attempt.

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
    where j.attempts < 5
      and (
        j.status = 'pending'
        or (
          j.status = 'failed'
          and (j.locked_until is null or j.locked_until < clock_timestamp())
        )
        or (
          j.status = 'running'
          and j.locked_until is not null
          and j.locked_until < clock_timestamp()
        )
      )
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
  backoff_seconds integer;
begin
  select *
  into job_row
  from public.word_validation_enrichment_jobs
  where id = p_job_id
  for update;

  if not found then
    raise exception 'Enrichment job not found';
  end if;

  backoff_seconds := least(900, 30 * (2 ^ greatest(job_row.attempts - 1, 0)))::integer;

  update public.word_validation_enrichment_jobs
  set status = 'failed'::public.word_validation_enrichment_status,
      locked_until = clock_timestamp() + make_interval(secs => backoff_seconds),
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

revoke all on function public.claim_word_validation_enrichment_jobs(integer, integer) from public, anon, authenticated;
revoke all on function public.fail_word_validation_enrichment(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_word_validation_enrichment_jobs(integer, integer) to service_role;
grant execute on function public.fail_word_validation_enrichment(uuid, text) to service_role;
