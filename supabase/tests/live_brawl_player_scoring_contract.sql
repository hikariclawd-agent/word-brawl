\set ON_ERROR_STOP on
begin;

do $$
<<fixture>>
declare
  settings jsonb := '{"bot_count":0,"bot_difficulty":"Normal","categories":["Name","Place","Animal","Food"],"match_duration_seconds":null,"mode_label":"Live Brawl","mode_rules":"v2 scoring","round_seconds":60,"scoring_owner":"Opponents","scoring_style":"Classic","target_rounds":1}';
  options jsonb := '{"visibility":"public","maxPlayers":5,"matchmakingBucket":"test:live-scoring-v2","rulesetVersion":2,"minClientVersion":"1.1.0"}';
  room_result jsonb; room_id uuid; player_id uuid; capability uuid; round_id uuid; human_actor uuid; human_assignment uuid; command_id uuid := gen_random_uuid();
  materialized jsonb; duplicate_result jsonb;
begin
  insert into public.bot_word_bank(category, word) values
    ('Name','Alice'),('Place','Accra'),('Animal','Antelope'),('Food','Apple')
  on conflict do nothing;

  room_result := public.create_managed_room('live-score-human','Human',settings,options);
  room_id := (room_result->>'roomId')::uuid;
  player_id := (room_result->>'playerId')::uuid;
  capability := (room_result->>'capability')::uuid;
  update public.rooms set bot_count=4, status='in_round', started_at=clock_timestamp() where id=fixture.room_id;
  insert into public.rounds(room_id, round_number, letter, status, starts_at, ends_at, revealed_at)
  values(room_id, 1, 'A', 'revealing', clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '1 minute', clock_timestamp())
  returning id into round_id;
  update public.rounds set scoring_ends_at=clock_timestamp()+interval '1 minute', dispute_ends_at=clock_timestamp()+interval '2 minutes' where id=fixture.round_id;
  insert into public.answers(round_id, room_player_id, category, answer_text, verdict, points)
  values
    (round_id, player_id, 'Name', 'Alice', 'valid', 10),
    (round_id, player_id, 'Place', 'Accra', 'valid', 10),
    (round_id, player_id, 'Animal', 'Antelope', 'valid', 10),
    (round_id, player_id, 'Food', 'Apple', 'valid', 10);

  materialized := public.materialize_live_brawl_scoring(room_id, round_id);
  assert (materialized->>'actorCount')::integer = 5, 'Expected one human plus four server-owned bot actors';
  assert (materialized->>'targetCount')::integer = 20, 'Expected 20 answer targets across four categories';
  assert (materialized->>'assignmentCount')::integer = 20, 'Expected one assignment per target';
  assert (materialized->>'botDecisionCount')::integer = 16, 'Expected 16 bot scorer decisions and four human assignments';
  assert (select count(*) = 0 from public.live_brawl_score_assignments a join public.live_brawl_answer_targets t on t.id=a.answer_target_id where t.actor_id=a.scorer_actor_id), 'Self-scoring assignment exists';
  assert (select count(*) = 4 from public.live_brawl_score_assignments a join public.live_brawl_actors s on s.id=a.scorer_actor_id where s.actor_kind='human'), 'Human must score one bot per category';
  assert (select count(*) = 4 from public.live_brawl_score_assignments a join public.live_brawl_actors t on t.id=(select actor_id from public.live_brawl_answer_targets where id=a.answer_target_id) join public.live_brawl_actors s on s.id=a.scorer_actor_id where t.actor_kind='bot' and s.actor_kind='human'), 'Human assignments must target bot answers';
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
end;
$$;

rollback;
