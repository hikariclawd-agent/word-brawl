\set ON_ERROR_STOP on

begin;

do $$
declare
  settings jsonb := '{"bot_count":0,"bot_difficulty":"Normal","categories":["Animal"],"match_duration_seconds":null,"mode_label":"Dispute QA","mode_rules":"Authority","round_seconds":30,"scoring_owner":"Opponents","scoring_style":"Classic","target_rounds":1}';
  created jsonb;
  joined jsonb;
  room_id uuid;
  opener_id uuid;
  owner_id uuid;
  opener_device text := 'stage2-dispute-opener-device';
  owner_device text := 'stage2-dispute-owner-device';
  room_code text;
  test_round_id uuid;
  answer_id uuid;
  dispute_id uuid;
  resolution jsonb;
  repeated_resolution jsonb;
begin
  created := public.create_managed_room(
    owner_device,
    'Owner',
    settings,
    '{"expiresInMinutes":10}'::jsonb
  );
  room_id := (created ->> 'roomId')::uuid;
  owner_id := (created ->> 'playerId')::uuid;

  assert (
    select scoring_rules = '{"unique":10,"shared":5,"no_score":0}'::jsonb
    from public.rooms
    where id = room_id
  ), 'Managed room did not receive the player-facing scoring default';

  select code into room_code
  from public.rooms
  where id = room_id;

  joined := public.join_managed_room(
    room_code,
    opener_device,
    'Opener',
    '{}'::jsonb
  );
  opener_id := (joined ->> 'playerId')::uuid;

  update public.rooms
  set status = 'revealing',
      started_at = clock_timestamp()
  where id = room_id;

  insert into public.rounds (
    room_id,
    round_number,
    letter,
    status,
    starts_at,
    ends_at,
    revealed_at,
    scoring_ends_at,
    dispute_ends_at,
    started_by_player_id
  ) values (
    room_id,
    1,
    'A',
    'revealing',
    clock_timestamp() - interval '90 seconds',
    clock_timestamp() - interval '30 seconds',
    clock_timestamp() - interval '20 seconds',
    clock_timestamp() - interval '10 seconds',
    clock_timestamp() - interval '1 second',
    owner_id
  )
  returning id into test_round_id;

  insert into public.answers (
    round_id,
    room_player_id,
    category,
    answer_text,
    verdict,
    points
  ) values (
    test_round_id,
    owner_id,
    'Animal',
    'Antelope',
    'valid',
    0
  )
  returning id into answer_id;

  assert (
    select points = 10
    from public.answers
    where id = answer_id
  ), 'Player-facing scoring keys did not score a valid answer';

  update public.answers set verdict = 'variant', points = 0 where id = answer_id;
  assert (select points = 5 from public.answers where id = answer_id),
    'Approved variant scoring did not use the shared score';

  update public.answers set verdict = 'valid', points = 0 where id = answer_id;

  -- Simulate an existing room that retained the pre-player-facing scoring map.
  -- These fixture writes are inside this transaction and are rolled back below.
  update public.rooms
  set scoring_rules = '{"valid":13,"duplicate":6,"variant":4,"invalid":1,"blank":0}'::jsonb
  where id = room_id;

  update public.answers set verdict = 'variant', points = 0 where id = answer_id;
  assert (select points = 4 from public.answers where id = answer_id),
    'Legacy variant scoring key was not preserved';

  update public.answers set verdict = 'duplicate', points = 0 where id = answer_id;
  assert (select points = 6 from public.answers where id = answer_id),
    'Legacy duplicate scoring key was not preserved';

  update public.answers set verdict = 'invalid', points = 10 where id = answer_id;
  assert (select points = 1 from public.answers where id = answer_id),
    'Legacy invalid scoring key was not preserved';

  update public.answers set verdict = 'valid', points = 0 where id = answer_id;
  assert (select points = 13 from public.answers where id = answer_id),
    'Legacy valid scoring key was not preserved';

  begin
    perform public.open_answer_dispute_command(
      room_id,
      test_round_id,
      answer_id,
      opener_id,
      opener_device
    );
    raise exception 'Late dispute was accepted';
  exception
    when query_canceled then
      null;
  end;

  update public.rounds
  set dispute_ends_at = clock_timestamp() + interval '60 seconds'
  where id = test_round_id;

  dispute_id := public.open_answer_dispute_command(
    room_id,
    test_round_id,
    answer_id,
    opener_id,
    opener_device
  );

  perform public.cast_answer_dispute_vote_command(
    room_id,
    test_round_id,
    dispute_id,
    owner_id,
    owner_device,
    'valid'
  );

  perform public.cast_answer_dispute_vote_command(
    room_id,
    test_round_id,
    dispute_id,
    opener_id,
    opener_device,
    'valid'
  );

  resolution := public.resolve_answer_dispute_command(
    room_id,
    test_round_id,
    dispute_id,
    opener_id,
    opener_device
  );

  assert resolution ->> 'resolved' = 'true', 'Dispute did not resolve';
  assert resolution ->> 'final_verdict' = 'valid', 'Unexpected dispute verdict';
  assert (resolution ->> 'points')::integer = 13,
    'Resolution receipt did not return persisted answer points';
  assert (resolution ->> 'score')::integer = 13,
    'Resolution receipt did not return the persisted round score';
  assert (
    select status = 'resolved' and final_verdict = 'valid'
    from public.answer_disputes
    where id = dispute_id
  ), 'Resolved dispute row was not persisted correctly';
  assert (
    select verdict = 'valid' and points = 13
    from public.answers
    where id = answer_id
  ), 'Resolved answer points do not match the receipt';
  assert (
    select score = 13 and answered_count = 1
    from public.round_scores rs
    where rs.round_id = test_round_id
      and rs.room_player_id = owner_id
  ), 'Round score does not match the persisted answer points';

  repeated_resolution := public.resolve_answer_dispute_command(
    room_id,
    test_round_id,
    dispute_id,
    opener_id,
    opener_device
  );

  assert (repeated_resolution ->> 'points')::integer = 13,
    'Idempotent resolution did not return persisted answer points';
  assert (repeated_resolution ->> 'score')::integer = 13,
    'Idempotent resolution did not return the persisted round score';
end $$;

rollback;
