\set ON_ERROR_STOP on
begin;

do $$
<<fixture>>
declare
  settings jsonb := '{"bot_count":0,"bot_difficulty":"Normal","categories":["Name","Place","Animal","Food"],"match_duration_seconds":null,"mode_label":"Live Brawl","mode_rules":"v2 scoring","round_seconds":60,"scoring_owner":"Opponents","scoring_style":"Classic","target_rounds":1}';
  options jsonb := '{"visibility":"public","maxPlayers":5,"matchmakingBucket":"test:live-scoring-v2","rulesetVersion":2,"minClientVersion":"1.1.0"}';
  room_result jsonb; room_id uuid; player_id uuid; capability uuid; round_id uuid; round2_id uuid;
  human_actor uuid; human_assignment uuid; human_target uuid; dispute_id uuid;
  command_id uuid := gen_random_uuid(); complete_command_id uuid := gen_random_uuid();
  materialized jsonb; duplicate_result jsonb; complete_result jsonb;
begin
  insert into public.bot_word_bank(category, word) values
    ('Name','Alice'),('Place','Accra'),('Animal','Antelope'),('Food','Apple')
  on conflict do nothing;

  room_result := public.create_managed_room('live-score-human','Human',settings,options);
  room_id := (room_result->>'roomId')::uuid;
  player_id := (room_result->>'playerId')::uuid;
  capability := (room_result->>'capability')::uuid;
  update public.rooms set bot_count=4, status='in_round', started_at=clock_timestamp() where id=fixture.room_id;
  insert into public.rounds(room_id, round_number, letter, status, starts_at, ends_at)
  values(room_id, 1, 'A', 'active', clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '1 minute')
  returning id into round_id;
  insert into public.answers(round_id, room_player_id, category, answer_text, verdict, points)
  values
    (round_id, player_id, 'Name', 'Alice', 'valid', 10),
    (round_id, player_id, 'Place', 'Accra', 'valid', 10),
    (round_id, player_id, 'Animal', 'Antelope', 'valid', 10),
    (round_id, player_id, 'Food', 'Apple', 'valid', 10);

  update public.rounds
  set status='revealing', revealed_at=clock_timestamp(), scoring_ends_at=clock_timestamp()+interval '1 minute', dispute_ends_at=clock_timestamp()+interval '2 minutes'
  where id=round_id;
  materialized := jsonb_build_object(
    'roomId', room_id,
    'roundId', round_id,
    'actorCount', (select count(*) from public.live_brawl_actors a where a.room_id=fixture.room_id),
    'targetCount', (select count(*) from public.live_brawl_answer_targets t where t.round_id=fixture.round_id),
    'assignmentCount', (select count(*) from public.live_brawl_score_assignments a where a.round_id=fixture.round_id),
    'botDecisionCount', (select count(*) from public.live_brawl_score_decisions d where d.round_id=fixture.round_id and d.source='bot')
  );
  assert (select count(*) = 5 from public.live_brawl_actors a where a.room_id=fixture.room_id), 'Reveal did not materialize five actors';
  assert (select count(*) = 20 from public.live_brawl_answer_targets t where t.round_id=fixture.round_id), 'Reveal did not materialize 20 targets';
  assert (select count(*) = 20 from public.live_brawl_score_assignments a where a.round_id=fixture.round_id), 'Reveal did not materialize 20 assignments';
  assert (materialized->>'actorCount')::integer = 5, 'Expected one human plus four server-owned bot actors';
  assert (materialized->>'targetCount')::integer = 20, 'Expected 20 answer targets across four categories';
  assert (materialized->>'assignmentCount')::integer = 20, 'Expected one assignment per target';
  assert (materialized->>'botDecisionCount')::integer = 16, 'Expected 16 bot scorer decisions and four human assignments';
  assert (select count(*) = 0 from public.live_brawl_score_assignments a join public.live_brawl_answer_targets t on t.id=a.answer_target_id where t.actor_id=a.scorer_actor_id), 'Self-scoring assignment exists';
  assert (select count(*) = 4 from public.live_brawl_score_assignments a join public.live_brawl_actors s on s.id=a.scorer_actor_id where s.actor_kind='human'), 'Human must score one bot per category';
  assert (select count(*) = 4 from public.live_brawl_score_assignments a join public.live_brawl_actors t on t.id=(select actor_id from public.live_brawl_answer_targets where id=a.answer_target_id) join public.live_brawl_actors s on s.id=a.scorer_actor_id where t.actor_kind='bot' and s.actor_kind='human'), 'Human assignments must target bot answers';
  assert (select bool_and(target_count = 4) from (select t.actor_id, count(*) as target_count from public.live_brawl_answer_targets t where t.round_id=fixture.round_id group by t.actor_id) counts), 'Every actor must have four category targets';
  assert not has_function_privilege('anon', 'public.materialize_live_brawl_scoring(uuid,uuid)', 'execute'), 'Materialization must be server-only';
  assert not has_function_privilege('anon', 'public.evaluate_live_brawl_bot_challenges(uuid,uuid)', 'execute'), 'Bot challenge evaluation must be server-only';
  assert not has_function_privilege('anon', 'public.resolve_live_brawl_dispute_command(uuid,uuid)', 'execute'), 'Dispute resolution must be server-only';
  assert not has_table_privilege('anon', 'public.live_brawl_score_decisions', 'insert'), 'Clients must not insert score decisions';
  assert public.materialize_live_brawl_scoring(room_id, round_id) = materialized, 'Repeated materialization changed the contract';

  select id into human_actor from public.live_brawl_actors a where a.room_id=fixture.room_id and a.actor_kind='human';
  select a.id into human_assignment
  from public.live_brawl_score_assignments a
  join public.live_brawl_actors s on s.id=a.scorer_actor_id
  where a.round_id=fixture.round_id and s.id=human_actor limit 1;
  perform public.cast_live_brawl_score_command(fixture.room_id, fixture.round_id, human_assignment, fixture.player_id, 'live-score-human', command_id, (select match_revision from public.rooms where id=fixture.room_id), 'valid');
  duplicate_result := public.cast_live_brawl_score_command(fixture.room_id, fixture.round_id, human_assignment, fixture.player_id, 'live-score-human', command_id, 999, 'invalid');
  assert (duplicate_result->>'duplicate')::boolean, 'Repeated score command was not idempotent';
  assert (select count(*) = 1 from public.live_brawl_score_decisions d where d.round_id=fixture.round_id and d.source='human'), 'Human score decision was not persisted';

  select t.id into human_target
  from public.live_brawl_answer_targets t
  where t.round_id=fixture.round_id and t.actor_id=human_actor and t.status='scored'
  limit 1;
  begin
    perform public.open_live_brawl_dispute_command(fixture.room_id, fixture.round_id, fixture.human_target, fixture.player_id, 'wrong-device', gen_random_uuid());
    raise exception 'Expected a capability rejection';
  exception when others then
    assert sqlstate = '42501', 'Wrong-device dispute attempt returned the wrong error';
  end;
  update public.rounds set dispute_ends_at=clock_timestamp()-interval '1 second' where id=fixture.round_id;
  begin
    perform public.open_live_brawl_dispute_command(fixture.room_id, fixture.round_id, fixture.human_target, fixture.player_id, 'live-score-human', gen_random_uuid());
    raise exception 'Expected a closed dispute window rejection';
  exception when others then
    assert sqlstate = '55000', 'Expired dispute attempt returned the wrong error';
  end;
  update public.rounds set dispute_ends_at=clock_timestamp()+interval '2 minutes' where id=fixture.round_id;
  update public.live_brawl_rules r set bot_challenge_percent=100 where r.room_id=fixture.room_id;
  perform public.open_live_brawl_dispute_command(fixture.room_id, fixture.round_id, fixture.human_target, fixture.player_id, 'live-score-human', gen_random_uuid());
  select id into dispute_id from public.live_brawl_disputes where answer_target_id=fixture.human_target;
  assert (select count(*)=4 from public.live_brawl_dispute_votes v where v.dispute_id=fixture.dispute_id and v.source='bot'), 'Human challenge must receive all bot votes';
  update public.rounds set scoring_ends_at=clock_timestamp()-interval '1 second', dispute_ends_at=clock_timestamp()-interval '1 second' where id=fixture.round_id;
  complete_result := public.complete_live_brawl_round_command(fixture.room_id, fixture.round_id, fixture.player_id, 'live-score-human', fixture.capability, fixture.complete_command_id, (select match_revision from public.rooms where id=fixture.room_id), true);
  assert (complete_result->>'accepted')::boolean, 'Round completion was not accepted';
  assert (select status='resolved' from public.live_brawl_disputes where id=fixture.dispute_id), 'Human dispute did not resolve';
  assert (select count(*) > 0 from public.live_brawl_disputes d where d.round_id=fixture.round_id and d.reason='deterministic bot challenge'), 'Bot challenges were not materialized';
  assert (select count(*)=0 from public.live_brawl_disputes d where d.round_id=fixture.round_id and d.status='open'), 'Round completed with an open dispute';
  assert (select count(*)=20 from public.live_brawl_score_decisions d where d.round_id=fixture.round_id), 'Every answer must have one terminal score decision';
  assert (select count(*)=5 from public.live_brawl_round_scores s where s.round_id=fixture.round_id), 'Every actor must receive a round score';
  duplicate_result := public.complete_live_brawl_round_command(fixture.room_id, fixture.round_id, fixture.player_id, 'live-score-human', fixture.capability, fixture.complete_command_id, 999, true);
  assert (duplicate_result->>'duplicate')::boolean, 'Repeated round completion was not idempotent';

  update public.rooms set status='in_round', ended_at=null where id=fixture.room_id;
  insert into public.rounds(room_id, round_number, letter, status, starts_at, ends_at, revealed_at, scoring_ends_at, dispute_ends_at)
  values(fixture.room_id, 2, 'B', 'revealing', clock_timestamp()-interval '2 minutes', clock_timestamp()-interval '1 minute', clock_timestamp(), clock_timestamp()-interval '1 second', clock_timestamp()+interval '1 minute')
  returning id into round2_id;
  update public.live_brawl_rules r set bot_challenge_percent=0 where r.room_id=fixture.room_id;
  complete_result := public.complete_live_brawl_round_command(fixture.room_id, fixture.round2_id, fixture.player_id, 'live-score-human', fixture.capability, gen_random_uuid(), (select match_revision from public.rooms where id=fixture.room_id), false);
  assert (complete_result->>'accepted')::boolean, 'Deadline completion was not accepted';
  assert (select count(*)=4 from public.live_brawl_score_decisions d where d.round_id=fixture.round2_id and d.source='timeout'), 'Pending human assignments did not timeout';
  assert (select status='scored' from public.rounds where id=fixture.round2_id), 'Timed-out round did not reach scored state';
end;
$$;

do $$
<<legacy_fixture>>
declare
  settings jsonb := '{"bot_count":0,"bot_difficulty":"Normal","categories":["Name","Place","Animal","Food"],"match_duration_seconds":null,"mode_label":"Live Brawl","mode_rules":"legacy scoring","round_seconds":60,"scoring_owner":"Opponents","scoring_style":"Classic","target_rounds":1}';
  options jsonb := '{"visibility":"public","maxPlayers":5,"matchmakingBucket":"test:live-scoring-v1","rulesetVersion":1,"minClientVersion":"1.1.0"}';
  room_result jsonb; room_id uuid; round_id uuid; snapshot_count integer;
begin
  room_result := public.create_managed_room('legacy-v1-human','Legacy Human',settings,options);
  room_id := (room_result->>'roomId')::uuid;
  update public.rooms set bot_count=4, status='in_round', started_at=clock_timestamp() where id=room_id;
  insert into public.rounds(room_id, round_number, letter, status, starts_at, ends_at)
  values(room_id, 1, 'A', 'active', clock_timestamp()-interval '2 minutes', clock_timestamp()-interval '1 minute')
  returning id into round_id;
  update public.rounds set status='revealing', revealed_at=clock_timestamp() where id=round_id;
  select count(*) into snapshot_count from public.bot_round_snapshots s where s.round_id=legacy_fixture.round_id;
  assert snapshot_count = 4, 'Legacy reveal did not preserve bot snapshots';
  assert (select count(*) = 0 from public.live_brawl_actors a where a.room_id=legacy_fixture.room_id), 'Legacy room unexpectedly created v2 actors';
end;
$$;

rollback;
