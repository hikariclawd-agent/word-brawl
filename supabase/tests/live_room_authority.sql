\set ON_ERROR_STOP on
begin;
do $$
declare
  s jsonb := '{"bot_count":0,"bot_difficulty":"Normal","categories":["Name","Place","Animal","Food","Object","Job","Brand"],"match_duration_seconds":null,"mode_label":"Live","mode_rules":"Test","round_seconds":90,"scoring_owner":"Opponents","scoring_style":"Classic","target_rounds":3}';
  o jsonb := '{"matchmakingBucket":"test:atomic:rollback","rulesetVersion":1,"minClientVersion":"1.0.0"}';
  a jsonb; b jsonb; c jsonb; d jsonb; e jsonb; other jsonb; solo jsonb;
  rid uuid; solo_rid uuid; pid uuid; cap uuid; solo_pid uuid; solo_cap uuid;
  rd record; solo_rd record; snap jsonb; enrichment_job record;
  rate_limited_claims integer;
  unknown_object text := 'Cromulent' || replace(gen_random_uuid()::text, '-', '');
  unknown_object_normalized text := public.normalize_live_brawl_answer(unknown_object);
begin
  assert public.normalize_live_brawl_answer('Élodie') = 'elodie', 'Diacritic normalization dropped accented name letters';
  assert public.normalize_live_brawl_answer('São Paulo') = 'saopaulo', 'Diacritic normalization failed for Brazilian place name';
  assert public.normalize_live_brawl_answer('Łódź') = 'lodz', 'Diacritic normalization failed for Polish place name';
  assert public.normalize_live_brawl_answer('München') = 'munchen', 'Diacritic normalization failed for German place name';
  assert public.normalize_live_brawl_answer('Cimamanda') = public.normalize_live_brawl_answer('Čimamanda'), 'Transliteration/diacritic spelling did not share a normalized key';
  assert public.normalize_live_brawl_answer('Ọlá') = 'ola', 'African name normalization failed for Yoruba dotted O';
  assert public.normalize_live_brawl_answer('Ṣẹgun') = 'segun', 'African name normalization failed for Yoruba dotted letters';
  assert public.normalize_live_brawl_answer('N’Djamena') = 'ndjamena', 'African place normalization failed for apostrophe variant';

  insert into public.bot_word_bank(category, word) values
    ('Name', 'Cimamanda'),
    ('Name', 'Ola'),
    ('Name', 'Segun'),
    ('Place', 'Sao Paulo'),
    ('Place', 'Lodz'),
    ('Place', 'Munchen'),
    ('Place', 'Munich'),
    ('Place', 'NDjamena')
  on conflict do nothing;

  insert into public.word_validation_cache(category, normalized_answer, display_answer, verdict, confidence, source, failure_reason)
  values
    ('Name', public.normalize_live_brawl_answer('Élodie'), 'Élodie', 'valid', 0.98, 'fixture:manual_name', null),
    ('Place', public.normalize_live_brawl_answer('Georgia'), 'Georgia', 'valid', 0.90, 'fixture:place', null),
    ('Name', public.normalize_live_brawl_answer('Georgia'), 'Georgia', 'disputed', 0.50, 'fixture:ambiguous_name', 'Ambiguous between name and place.'),
    ('Place', public.normalize_live_brawl_answer('Nairobi'), 'Nairobi', 'invalid', 0.95, 'fixture:manual_override', 'Manual cache override for source precedence test.')
  on conflict (category, normalized_answer)
  do update set verdict = excluded.verdict,
                confidence = excluded.confidence,
                source = excluded.source,
                failure_reason = excluded.failure_reason;

  insert into public.bot_word_bank(category, word) values ('Place', 'Nairobi') on conflict do nothing;

  assert public.validate_live_brawl_answer('Elodie', 'Name', 'E') = 'valid'::public.answer_verdict, 'Alternative spelling failed to hit accented-name cache';
  assert public.validate_live_brawl_answer('Čimamanda', 'Name', 'C') = 'valid'::public.answer_verdict, 'Diacritic transliteration failed to hit same-category name bank';
  assert public.validate_live_brawl_answer('Ọlá', 'Name', 'O') = 'valid'::public.answer_verdict, 'African dotted name failed to hit same-category name bank';
  assert public.validate_live_brawl_answer('Ṣẹgun', 'Name', 'S') = 'valid'::public.answer_verdict, 'African dotted name failed to hit same-category name bank';
  assert public.validate_live_brawl_answer('São Paulo', 'Place', 'S') = 'valid'::public.answer_verdict, 'Diacritic place spelling failed to hit transliterated place bank';
  assert public.validate_live_brawl_answer('Łódź', 'Place', 'L') = 'valid'::public.answer_verdict, 'Diacritic place spelling failed to hit transliterated place bank';
  assert public.validate_live_brawl_answer('München', 'Place', 'M') = 'valid'::public.answer_verdict, 'Diacritic place spelling failed to hit transliterated place bank';
  assert public.validate_live_brawl_answer('Munich', 'Place', 'M') = 'valid'::public.answer_verdict, 'Alternative place spelling fixture failed';
  assert public.validate_live_brawl_answer('N’Djamena', 'Place', 'N') = 'valid'::public.answer_verdict, 'African apostrophe place fixture failed';
  assert public.validate_live_brawl_answer('Georgia', 'Place', 'G') = 'valid'::public.answer_verdict, 'Ambiguous place fixture did not keep category-specific valid verdict';
  assert public.validate_live_brawl_answer('Georgia', 'Name', 'G') = 'disputed'::public.answer_verdict, 'Ambiguous name fixture did not keep category-specific reviewable verdict';
  assert public.validate_live_brawl_answer('Nairobi', 'Place', 'N') = 'invalid'::public.answer_verdict, 'Cache source precedence did not override local word bank';

  a := find_or_create_public_room('test-device-one','One',s,o);
  rid := (a->>'roomId')::uuid;
  pid := (a->>'playerId')::uuid;
  cap := (a->>'capability')::uuid;

  select * into rd from advance_live_brawl_session(rid,pid,'A','test-device-one',cap);
  assert rd.room_status = 'lobby' and rd.round_id is null and rd.bot_count = 0, 'First 650ms window violated';

  b := find_or_create_public_room('test-device-two','Two',s,o);
  assert b->>'roomId' = a->>'roomId', 'Second human did not join waiting room';
  assert (select max_players = 5 from rooms where id = rid), 'Public room target size changed';

  perform update_online_room_settings(rid,pid,'test-device-one',cap,s||'{"round_seconds":120}');
  begin perform update_online_room_settings(rid,pid,'wrong-device',cap,s); raise exception 'Wrong device accepted'; exception when insufficient_privilege then null; end;
  begin perform update_online_room_settings(rid,pid,'test-device-one',gen_random_uuid(),s); raise exception 'Wrong capability accepted'; exception when insufficient_privilege then null; end;
  begin perform update_online_room_settings(rid,(b->>'playerId')::uuid,'test-device-two',(b->>'capability')::uuid,s); raise exception 'Nonhost accepted'; exception when insufficient_privilege then null; end;
  other := create_managed_room('test-other-host','Other',s);
  begin perform update_online_room_settings(rid,(other->>'playerId')::uuid,'test-other-host',(other->>'capability')::uuid,s); raise exception 'Cross room host accepted'; exception when insufficient_privilege then null; end;

  update rooms set live_brawl_seat_window_started_at = clock_timestamp() - interval '651 milliseconds' where id = rid;
  select * into rd from advance_live_brawl_session(rid,pid,'A','test-device-one',cap,30,5);
  assert rd.bot_count = 1 and rd.room_status = 'lobby' and rd.round_id is null, 'First expired window should add exactly one bot';
  select * into rd from advance_live_brawl_session(rid,pid,'A','test-device-one',cap,30,5);
  assert rd.bot_count = 1 and rd.room_status = 'lobby' and rd.round_id is null, 'Retry added duplicate bot in same window';

  c := find_or_create_public_room('test-device-three','Three',s,o);
  assert c->>'roomId' = a->>'roomId', 'Human did not join next window';
  assert (select bot_count = 1 from rooms where id = rid), 'Human replaced a committed bot';

  update room_players set status='disconnected', left_at=clock_timestamp() where id=pid;
  d := find_or_create_public_room('test-device-one','One',s,o,jsonb_build_object(pid::text,cap::text));
  assert d->>'playerId' = pid::text and d->>'roomId' = rid::text, 'Reconnect identity changed';

  e := find_or_create_public_room('test-device-four','Four',s,o);
  assert e->>'roomId' = a->>'roomId', 'Fourth human did not join open seat';
  assert (
    select count(*) + max(rooms.bot_count) = 5
    from room_players join rooms on rooms.id = room_players.room_id
    where rooms.id = rid and room_players.role = 'player' and room_players.status = 'active'
  ), 'Expected four humans plus one bot before start';

  select * into rd from advance_live_brawl_session(rid,pid,'A','test-device-one',cap,30,5);
  assert rd.bot_count = 1 and rd.room_status = 'in_round', 'Five-seat roster did not start';
  assert (select ends_at - starts_at = interval '120 seconds' from rounds where id = rd.round_id), 'Round duration changed';
  perform advance_live_brawl_session(rid,pid,'B','test-device-one',cap,30,5);
  assert (select count(*) = 1 from rounds where room_id = rid), 'Advance duplicated round';
  begin perform update_online_room_settings(rid,pid,'test-device-one',cap,s); raise exception 'Started setup accepted'; exception when raise_exception then assert sqlerrm='Room setup is locked.'; end;
  begin insert into room_players(room_id,device_player_id,display_name) values(rid,'late-insert-device','Late'); raise exception 'Late direct join accepted'; exception when raise_exception then assert sqlerrm='Live Brawl seats are locked'; end;
  assert (find_or_create_public_room('test-late-device','Late',s,o)->>'roomId') <> rid::text, 'Late public join reused started room';

  begin perform get_online_bot_round_snapshot(rid,rd.round_id); raise exception 'Early answers leaked'; exception when raise_exception then assert sqlerrm='Bot answers are hidden until reveal'; end;
  update rounds set status='revealing' where id=rd.round_id;
  snap := get_online_bot_round_snapshot(rid,rd.round_id);
  assert jsonb_array_length(snap->'bots') = 1, 'Mixed room should have one bot snapshot';
  assert (select bool_and((bot_entry->>'score')::int=(select sum((ans->>'points')::int) from jsonb_array_elements(bot_entry->'answers') ans)) from jsonb_array_elements(snap->'bots') bot_entry), 'Bot score disagrees with answers';
  assert snap = get_online_bot_round_snapshot(rid,rd.round_id), 'Snapshot not idempotent';
  assert (select count(*) = 1 from bot_round_snapshots where round_id = rd.round_id), 'Bot snapshot record mismatch';

  solo := find_or_create_public_room('test-device-solo','Solo',s,o||'{"matchmakingBucket":"test:atomic:botfill"}');
  solo_rid := (solo->>'roomId')::uuid;
  solo_pid := (solo->>'playerId')::uuid;
  solo_cap := (solo->>'capability')::uuid;
  for i in 1..4 loop
    update rooms set live_brawl_seat_window_started_at = clock_timestamp() - interval '651 milliseconds' where id = solo_rid;
    select * into solo_rd from advance_live_brawl_session(solo_rid,solo_pid,'C','test-device-solo',solo_cap,30,5);
  end loop;
  assert solo_rd.bot_count = 4 and solo_rd.room_status = 'in_round', 'Solo room should fill four permanent bot seats';
  perform submit_answer_command(
    solo_rid,
    solo_pid,
    'test-device-solo',
    gen_random_uuid(),
    (select match_revision from rooms where id = solo_rid),
    jsonb_build_object(
      'Name', 'Caleb',
      'Place', 'Cairo',
      'Animal', 'Cat',
      'Food', 'Cat',
      'Object', unknown_object,
      'Job', 'Chef',
      'Brand', 'Canon'
    )
  );
  assert (
    select score = 50
    from round_scores
    where round_id = solo_rd.round_id
      and room_player_id = solo_pid
  ), 'Solo human score was not server-scored with reviewable unknowns';
  assert (
    select count(*) = 5
    from answers
    where round_id = solo_rd.round_id
      and room_player_id = solo_pid
      and verdict = 'valid'
      and points = 10
  ), 'Known valid solo answers were not accepted';
  assert (
    select verdict = 'invalid' and points = 0
    from answers
    where round_id = solo_rd.round_id
      and room_player_id = solo_pid
      and category = 'Food'
  ), 'Wrong-category known answer was not rejected';
  assert (
    select verdict = 'disputed' and points = 0
    from answers
    where round_id = solo_rd.round_id
      and room_player_id = solo_pid
      and category = 'Object'
  ), 'Unknown answer was not left reviewable';
  assert exists(
    select 1
    from word_validation_cache
    where category = 'Object'
      and normalized_answer = unknown_object_normalized
      and verdict = 'disputed'
  ), 'Unknown answer was not cached for background enrichment';
  assert (
    select count(*) = 1
    from word_validation_enrichment_jobs
    where category = 'Object'
      and normalized_answer = unknown_object_normalized
      and status = 'pending'
  ), 'Unknown answer did not enqueue exactly one enrichment job';
  perform public.validate_live_brawl_answer(unknown_object,'Object','C');
  assert (
    select count(*) = 1
    from word_validation_enrichment_jobs
    where category = 'Object'
      and normalized_answer = unknown_object_normalized
  ), 'Repeated unknown validation duplicated enrichment jobs';
  update word_validation_enrichment_jobs
  set last_requested_at = clock_timestamp() - interval '100 years'
  where category = 'Object'
    and normalized_answer = unknown_object_normalized;
  select * into enrichment_job from public.claim_word_validation_enrichment_jobs(1, 60);
  assert enrichment_job.normalized_answer = unknown_object_normalized and enrichment_job.attempts = 1, 'Enrichment job was not claimable';
  update word_validation_enrichment_jobs
  set status = 'running',
      locked_until = clock_timestamp() - interval '1 second'
  where id = enrichment_job.id;
  select * into enrichment_job from public.claim_word_validation_enrichment_jobs(1, 60);
  assert enrichment_job.normalized_answer = unknown_object_normalized and enrichment_job.attempts = 2, 'Expired running enrichment job was not reclaimed';
  perform public.fail_word_validation_enrichment(enrichment_job.id, 'temporary provider failure');
  assert not exists (
    select 1
    from public.claim_word_validation_enrichment_jobs(1, 60)
    where id = enrichment_job.id
  ), 'Failed enrichment job ignored retry backoff';
  update word_validation_enrichment_jobs
  set locked_until = clock_timestamp() - interval '1 second'
  where id = enrichment_job.id;
  select * into enrichment_job from public.claim_word_validation_enrichment_jobs(1, 60);
  assert enrichment_job.normalized_answer = unknown_object_normalized and enrichment_job.attempts = 3, 'Expired failed enrichment job was not retried after backoff';
  perform public.complete_word_validation_enrichment(
    enrichment_job.id,
    'disputed',
    0.44,
    'test-enricher',
    'test://unknown-object',
    'Still reviewable after enrichment.'
  );
  perform public.record_word_validation_enrichment_event(
    enrichment_job.id,
    'Object',
    unknown_object_normalized,
    'test-enricher',
    true,
    12,
    'disputed',
    null,
    null
  );
  assert (
    select enrichment_status = 'succeeded'
      and source = 'test-enricher'
      and source_ref = 'test://unknown-object'
    from word_validation_cache
    where category = 'Object'
      and normalized_answer = unknown_object_normalized
  ), 'Enrichment completion did not update validation cache';
  assert (
    select status = 'succeeded'::public.word_validation_enrichment_status
      and locked_until is null
    from word_validation_enrichment_jobs
    where id = enrichment_job.id
  ), 'Succeeded enrichment job was not finalized';
  assert exists (
    select 1
    from word_validation_enrichment_events
    where job_id = enrichment_job.id
      and provider = 'test-enricher'
      and success
  ), 'Enrichment event was not recorded';

  insert into public.word_validation_cache(category, normalized_answer, display_answer, verdict, confidence, source, failure_reason, enrichment_status, enrichment_requested_at)
  select
    'Object',
    'qaratelimit' || n::text,
    'QARateLimit' || n::text,
    'disputed',
    0.25,
    'server_fallback',
    'Rate-limit fixture.',
    'pending'::public.word_validation_enrichment_status,
    clock_timestamp()
  from generate_series(1, 30) as n
  on conflict (category, normalized_answer) do nothing;

  insert into public.word_validation_enrichment_jobs(category, normalized_answer, display_answer, status, last_requested_at)
  select
    'Object',
    'qaratelimit' || n::text,
    'QARateLimit' || n::text,
    'pending'::public.word_validation_enrichment_status,
    clock_timestamp() - interval '100 years'
  from generate_series(1, 30) as n
  on conflict (category, normalized_answer)
  do update set status = 'pending'::public.word_validation_enrichment_status,
                attempts = 0,
                locked_until = null,
                last_requested_at = excluded.last_requested_at;

  select count(*)::integer into rate_limited_claims
  from public.claim_word_validation_enrichment_jobs(100, 60)
  where normalized_answer like 'qaratelimit%';
  assert rate_limited_claims = 25, 'Worker claim rate limit did not cap a large batch at 25 jobs';

  assert not has_column_privilege('anon','rooms','bot_count','UPDATE'), 'Direct settings writable';
  assert not has_column_privilege('anon','room_players','is_host','UPDATE'), 'Host identity writable';
  assert not has_table_privilege('anon','room_player_capabilities','SELECT'), 'Capability readable';
  assert not has_table_privilege('anon','bot_round_snapshots','UPDATE'), 'Bot score writable';
  execute 'set local role anon';
  begin execute 'update rooms set bot_count=7 where id='||quote_literal(rid); raise exception 'Guest direct update accepted'; exception when insufficient_privilege then null; end;
  begin perform update_online_room_settings(rid,pid,'test-device-one',gen_random_uuid(),s); raise exception 'Guest forged capability accepted'; exception when insufficient_privilege then null; end;
  execute 'reset role';

  raise notice 'PASS: five seats, sequential bot fill, no replacement, replay, permissions, snapshots, reconnect';
end $$;
rollback;
