begin;

do $$
declare
  job record;
  rate_limited_claims integer;
begin
  assert public.normalize_live_brawl_answer('Ọlá') = 'ola', 'Yoruba dotted O did not normalize';
  assert public.normalize_live_brawl_answer('Ṣẹgun') = 'segun', 'Yoruba dotted letters did not normalize';
  assert public.normalize_live_brawl_answer('N’Djamena') = 'ndjamena', 'African apostrophe place did not normalize';
  assert public.normalize_live_brawl_answer('Élodie') = 'elodie', 'Accented international name did not normalize';
  assert public.normalize_live_brawl_answer('Łódź') = 'lodz', 'Accented international place did not normalize';
  assert public.normalize_live_brawl_answer('São Paulo') = 'saopaulo', 'Accented city did not normalize';

  insert into public.bot_word_bank(category, word) values
    ('Name', 'Ola'),
    ('Name', 'Segun'),
    ('Place', 'NDjamena'),
    ('Place', 'Lodz'),
    ('Place', 'Sao Paulo')
  on conflict do nothing;

  insert into public.word_validation_cache(category, normalized_answer, display_answer, verdict, confidence, source, failure_reason)
  values
    ('Name', public.normalize_live_brawl_answer('Georgia'), 'Georgia', 'disputed', 0.50, 'staging:ambiguous_name', 'Ambiguous between name and place.'),
    ('Place', public.normalize_live_brawl_answer('Georgia'), 'Georgia', 'valid', 0.90, 'staging:place', null),
    ('Place', public.normalize_live_brawl_answer('Nairobi'), 'Nairobi', 'invalid', 0.95, 'staging:manual_override', 'Source precedence smoke override.')
  on conflict (category, normalized_answer)
  do update set verdict = excluded.verdict,
                confidence = excluded.confidence,
                source = excluded.source,
                failure_reason = excluded.failure_reason;

  insert into public.bot_word_bank(category, word) values ('Place', 'Nairobi') on conflict do nothing;

  assert public.validate_live_brawl_answer('Ọlá', 'Name', 'O') = 'valid'::public.answer_verdict, 'African name fixture failed';
  assert public.validate_live_brawl_answer('Ṣẹgun', 'Name', 'S') = 'valid'::public.answer_verdict, 'African name fixture failed';
  assert public.validate_live_brawl_answer('N’Djamena', 'Place', 'N') = 'valid'::public.answer_verdict, 'African city fixture failed';
  assert public.validate_live_brawl_answer('Łódź', 'Place', 'L') = 'valid'::public.answer_verdict, 'International city fixture failed';
  assert public.validate_live_brawl_answer('São Paulo', 'Place', 'S') = 'valid'::public.answer_verdict, 'International city fixture failed';
  assert public.validate_live_brawl_answer('Georgia', 'Name', 'G') = 'disputed'::public.answer_verdict, 'Ambiguous name fixture did not stay reviewable';
  assert public.validate_live_brawl_answer('Georgia', 'Place', 'G') = 'valid'::public.answer_verdict, 'Ambiguous place fixture did not stay valid';
  assert public.validate_live_brawl_answer('Nairobi', 'Place', 'N') = 'invalid'::public.answer_verdict, 'Cache source precedence did not override local bank';

  insert into public.word_validation_cache(category, normalized_answer, display_answer, verdict, confidence, source, failure_reason, enrichment_status, enrichment_requested_at)
  values ('Object', 'stagingreliability', 'StagingReliability', 'disputed', 0.25, 'staging_smoke', 'Reliability smoke.', 'pending'::public.word_validation_enrichment_status, clock_timestamp())
  on conflict (category, normalized_answer)
  do update set verdict = 'disputed'::public.answer_verdict,
                enrichment_status = 'pending'::public.word_validation_enrichment_status,
                enrichment_requested_at = clock_timestamp();

  insert into public.word_validation_enrichment_jobs(category, normalized_answer, display_answer, status, attempts, locked_until, last_requested_at)
  values ('Object', 'stagingreliability', 'StagingReliability', 'pending'::public.word_validation_enrichment_status, 0, null, clock_timestamp() - interval '100 years')
  on conflict (category, normalized_answer)
  do update set status = 'pending'::public.word_validation_enrichment_status,
                attempts = 0,
                locked_until = null,
                last_requested_at = excluded.last_requested_at;

  select * into job from public.claim_word_validation_enrichment_jobs(1, 60)
  where normalized_answer = 'stagingreliability';
  assert job.normalized_answer = 'stagingreliability' and job.attempts = 1, 'Pending job was not claimable';

  update public.word_validation_enrichment_jobs
  set status = 'running'::public.word_validation_enrichment_status,
      locked_until = clock_timestamp() - interval '1 second'
  where id = job.id;

  select * into job from public.claim_word_validation_enrichment_jobs(1, 60)
  where id = job.id;
  assert job.normalized_answer = 'stagingreliability' and job.attempts = 2, 'Expired running job was not reclaimable';

  perform public.fail_word_validation_enrichment(job.id, 'staging simulated provider failure');
  assert not exists (
    select 1 from public.claim_word_validation_enrichment_jobs(1, 60)
    where id = job.id
  ), 'Failed job ignored retry backoff';

  update public.word_validation_enrichment_jobs
  set locked_until = clock_timestamp() - interval '1 second'
  where id = job.id;

  select * into job from public.claim_word_validation_enrichment_jobs(1, 60)
  where id = job.id;
  assert job.normalized_answer = 'stagingreliability' and job.attempts = 3, 'Expired failed job did not retry after backoff';

  insert into public.word_validation_enrichment_jobs(category, normalized_answer, display_answer, status, attempts, locked_until, last_requested_at)
  select 'Object', 'stagingratelimit' || n::text, 'StagingRateLimit' || n::text, 'pending'::public.word_validation_enrichment_status, 0, null, clock_timestamp() - interval '100 years'
  from generate_series(1, 30) as n
  on conflict (category, normalized_answer)
  do update set status = 'pending'::public.word_validation_enrichment_status,
                attempts = 0,
                locked_until = null,
                last_requested_at = excluded.last_requested_at;

  select count(*)::integer into rate_limited_claims
  from public.claim_word_validation_enrichment_jobs(100, 60)
  where normalized_answer like 'stagingratelimit%';
  assert rate_limited_claims = 25, 'Claim rate limit did not cap batch at 25 jobs';

  raise notice 'PASS: staging validation smoke fixtures, source precedence, retry backoff, stale reclaim, rate limit';
end $$;

rollback;
