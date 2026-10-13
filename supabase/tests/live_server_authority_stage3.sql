begin;

do $$
declare
  settings jsonb := '{"bot_count":0,"bot_difficulty":"Normal","categories":["Name","Animal"],"match_duration_seconds":null,"mode_label":"Stage3","mode_rules":"Authority","round_seconds":30,"scoring_owner":"Opponents","scoring_style":"Classic","target_rounds":1}';
  created jsonb;
  joined jsonb;
  start_result jsonb;
  host_submit jsonb;
  guest_submit jsonb;
  complete_result jsonb;
  room_id uuid;
  host_id uuid;
  host_cap uuid;
  guest_id uuid;
  test_round_id uuid;
  room_code text;
  revision bigint;
  answer_row record;
begin
  created := public.create_managed_room(
    'stage3-host-device',
    'Host',
    settings,
    '{"expiresInMinutes":10}'::jsonb
  );
  room_id := (created ->> 'roomId')::uuid;
  host_id := (created ->> 'playerId')::uuid;
  host_cap := (created ->> 'capability')::uuid;

  select code into room_code from public.rooms where id = room_id;

  joined := public.join_managed_room(
    room_code,
    'stage3-guest-device',
    'Guest',
    '{}'::jsonb
  );
  guest_id := (joined ->> 'playerId')::uuid;

  select match_revision into revision from public.rooms where id = room_id;
  start_result := public.start_online_round_command(
    room_id,
    host_id,
    'stage3-host-device',
    host_cap,
    gen_random_uuid(),
    revision,
    'A',
    30
  );
  test_round_id := (start_result ->> 'round_id')::uuid;

  assert start_result ->> 'accepted' = 'true', 'Start command was rejected';
  assert (select status = 'in_round' from public.rooms where id = room_id), 'Room did not enter round';
  assert (select status = 'active' from public.rounds where id = test_round_id), 'Round did not become active';

  select match_revision into revision from public.rooms where id = room_id;
  host_submit := public.submit_answer_command(
    room_id,
    host_id,
    'stage3-host-device',
    gen_random_uuid(),
    revision,
    '{"Name":"Alex","Animal":"Antelope"}'::jsonb
  );
  assert host_submit ->> 'revealed' = 'false', 'Round revealed before all players submitted';
  assert (select status = 'active' from public.rounds where id = test_round_id), 'Round changed phase too early';
  assert (
    select count(*) = 2
    from public.answers
    where round_id = test_round_id
      and room_player_id = host_id
  ), 'Submission did not create one locked answer per configured category';

  select match_revision into revision from public.rooms where id = room_id;
  begin
    perform public.submit_answer_command(
      room_id,
      guest_id,
      'stage3-guest-device',
      gen_random_uuid(),
      revision,
      '{"Name":"Amina","Animal":"Ape","Injected":"Admin"}'::jsonb
    );
    raise exception 'Unknown answer category accepted';
  exception when invalid_parameter_value then
    null;
  end;

  select match_revision into revision from public.rooms where id = room_id;
  begin
    perform public.submit_answer_command(
      room_id,
      guest_id,
      'stage3-guest-device',
      gen_random_uuid(),
      revision,
      jsonb_build_object('Name', repeat('A', 121), 'Animal', 'Ape')
    );
    raise exception 'Overlong answer accepted';
  exception when string_data_right_truncation then
    null;
  end;

  select match_revision into revision from public.rooms where id = room_id;
  guest_submit := public.submit_answer_command(
    room_id,
    guest_id,
    'stage3-guest-device',
    gen_random_uuid(),
    revision,
    '{"Name":"Amina","Animal":"Ape"}'::jsonb
  );
  assert guest_submit ->> 'revealed' = 'true', 'Round did not reveal after all players submitted';
  assert (select status = 'revealing' from public.rooms where id = room_id), 'Room did not enter reveal';
  assert (select status = 'revealing' from public.rounds where id = test_round_id), 'Round did not enter reveal';
  assert (
    select count(*) = 4
    from public.answers
    where round_id = test_round_id
  ), 'Round did not contain complete category answers for both players';

  for answer_row in
    select id, room_player_id
    from public.answers
    where public.answers.round_id = test_round_id
  loop
    select match_revision into revision from public.rooms where id = room_id;
    if answer_row.room_player_id = host_id then
      perform public.submit_answer_vote_command(
        room_id,
        guest_id,
        'stage3-guest-device',
        gen_random_uuid(),
        revision,
        answer_row.id,
        'valid'
      );
    else
      perform public.submit_answer_vote_command(
        room_id,
        host_id,
        'stage3-host-device',
        gen_random_uuid(),
        revision,
        answer_row.id,
        'valid'
      );
    end if;
  end loop;

  select match_revision into revision from public.rooms where id = room_id;
  complete_result := public.complete_online_round_command(
    room_id,
    test_round_id,
    host_id,
    'stage3-host-device',
    host_cap,
    gen_random_uuid(),
    revision,
    true
  );

  assert complete_result ->> 'accepted' = 'true', 'Complete command was rejected';
  assert (select status = 'scored' from public.rounds where id = test_round_id), 'Round was not scored';
  assert (select status = 'finished' from public.rooms where id = room_id), 'Room was not finished';

  assert not has_table_privilege('anon', 'answers', 'INSERT'), 'anon can insert answers directly';
  assert not has_table_privilege('anon', 'answers', 'UPDATE'), 'anon can update answers directly';
  assert not has_table_privilege('anon', 'rounds', 'INSERT'), 'anon can insert rounds directly';
  assert not has_table_privilege('anon', 'rounds', 'UPDATE'), 'anon can update rounds directly';
  assert not has_table_privilege('anon', 'round_scores', 'INSERT'), 'anon can insert round scores directly';
  assert not has_table_privilege('anon', 'round_scores', 'UPDATE'), 'anon can update round scores directly';
  assert not has_table_privilege('anon', 'room_players', 'INSERT'), 'anon can insert room players directly';
  assert not has_column_privilege('anon', 'rooms', 'status', 'UPDATE'), 'anon can update room status directly';
  assert has_function_privilege('anon', 'public.start_online_round_command(uuid,uuid,text,uuid,uuid,bigint,text,integer)', 'EXECUTE'), 'anon cannot execute start command';
  assert has_function_privilege('anon', 'public.complete_online_round_command(uuid,uuid,uuid,text,uuid,uuid,bigint,boolean)', 'EXECUTE'), 'anon cannot execute complete command';
end $$;

rollback;
