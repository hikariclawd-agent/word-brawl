begin;

do $$
declare
  settings jsonb := '{"bot_count":0,"bot_difficulty":"Normal","categories":["Name","Place","Animal"],"match_duration_seconds":null,"mode_label":"Staging Smoke","mode_rules":"Hosted","round_seconds":45,"scoring_owner":"Opponents","scoring_style":"Classic","target_rounds":1}';
  options jsonb := jsonb_build_object(
    'matchmakingBucket',
    'staging:live-flow:' || replace(gen_random_uuid()::text, '-', ''),
    'rulesetVersion',
    1,
    'minClientVersion',
    '1.1.0'
  );
  host_join jsonb;
  guest_join jsonb;
  start_result jsonb;
  host_submit jsonb;
  guest_submit jsonb;
  complete_result jsonb;
  room_id uuid;
  host_id uuid;
  host_cap uuid;
  guest_id uuid;
  guest_cap uuid;
  test_round_id uuid;
  revision bigint;
  answer_row record;
begin
  host_join := public.find_or_create_public_room(
    'staging-device-host',
    'Staging Host',
    settings,
    options
  );
  room_id := (host_join ->> 'roomId')::uuid;
  host_id := (host_join ->> 'playerId')::uuid;
  host_cap := (host_join ->> 'capability')::uuid;

  guest_join := public.find_or_create_public_room(
    'staging-device-guest',
    'Staging Guest',
    settings,
    options
  );
  guest_id := (guest_join ->> 'playerId')::uuid;
  guest_cap := (guest_join ->> 'capability')::uuid;

  assert (guest_join ->> 'roomId')::uuid = room_id, 'Matchmaking did not place both players in one room';
  assert host_id <> guest_id, 'Matchmaking reused player identity';

  select match_revision into revision from public.rooms where id = room_id;
  start_result := public.start_online_round_command(
    room_id,
    host_id,
    'staging-device-host',
    host_cap,
    gen_random_uuid(),
    revision,
    'A',
    45
  );
  test_round_id := (start_result ->> 'round_id')::uuid;

  assert start_result ->> 'accepted' = 'true', 'Hosted round start was rejected';
  assert (select status = 'in_round' from public.rooms where id = room_id), 'Room did not enter in_round';

  select match_revision into revision from public.rooms where id = room_id;
  host_submit := public.submit_answer_command(
    room_id,
    host_id,
    'staging-device-host',
    gen_random_uuid(),
    revision,
    jsonb_build_object('Name', 'Amina', 'Place', 'Accra', 'Animal', 'Antelope')
  );
  assert host_submit ->> 'revealed' = 'false', 'Hosted flow revealed before guest submitted';

  select match_revision into revision from public.rooms where id = room_id;
  guest_submit := public.submit_answer_command(
    room_id,
    guest_id,
    'staging-device-guest',
    gen_random_uuid(),
    revision,
    jsonb_build_object('Name', 'Ọlá', 'Place', 'N’Djamena', 'Animal', 'Ape')
  );
  assert guest_submit ->> 'revealed' = 'true', 'Hosted flow did not reveal after both submissions';
  assert (
    select count(*) = 6
    from public.answers
    where round_id = test_round_id
  ), 'Hosted flow did not create one answer per configured category/player';

  for answer_row in
    select id, room_player_id
    from public.answers
    where round_id = test_round_id
  loop
    select match_revision into revision from public.rooms where id = room_id;
    if answer_row.room_player_id = host_id then
      perform public.submit_answer_vote_command(
        room_id,
        guest_id,
        'staging-device-guest',
        gen_random_uuid(),
        revision,
        answer_row.id,
        'valid'
      );
    else
      perform public.submit_answer_vote_command(
        room_id,
        host_id,
        'staging-device-host',
        gen_random_uuid(),
        revision,
        answer_row.id,
        'valid'
      );
    end if;
  end loop;

  assert (
    select count(*) = 6
    from public.votes v
    join public.answers a on a.id = v.answer_id
    where a.round_id = test_round_id
  ), 'Hosted flow did not record all scoring votes';

  select match_revision into revision from public.rooms where id = room_id;
  complete_result := public.complete_online_round_command(
    room_id,
    test_round_id,
    host_id,
    'staging-device-host',
    host_cap,
    gen_random_uuid(),
    revision,
    true
  );

  assert complete_result ->> 'accepted' = 'true', 'Hosted completion was rejected';
  assert (select status = 'scored' from public.rounds where id = test_round_id), 'Hosted round was not scored';
  assert (select status = 'finished' from public.rooms where id = room_id), 'Hosted room was not finalised';
  assert (
    select count(*) = 2
    from public.round_scores
    where round_id = test_round_id
  ), 'Hosted score reconciliation did not create both score rows';

  raise notice 'PASS: hosted matchmaking, validation, submission, voting, scoring, finalisation';
end $$;

rollback;
