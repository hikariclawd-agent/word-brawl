begin;

do $$
declare
  room_id uuid;
  opener_id uuid;
  owner_id uuid;
  opener_device text := 'stage2-dispute-opener-device';
  owner_device text := 'stage2-dispute-owner-device';
  round_id uuid;
  answer_id uuid;
  dispute_id uuid;
  resolution jsonb;
begin
  insert into public.rooms (
    code,
    status,
    categories,
    expires_at
  ) values (
    'QADSP2',
    'revealing',
    array['Animal'],
    clock_timestamp() + interval '1 hour'
  )
  returning id into room_id;

  insert into public.room_players (
    room_id,
    device_player_id,
    display_name,
    is_host
  ) values (
    room_id,
    owner_device,
    'Owner',
    true
  )
  returning id into owner_id;

  insert into public.room_players (
    room_id,
    device_player_id,
    display_name
  ) values (
    room_id,
    opener_device,
    'Opener'
  )
  returning id into opener_id;

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
  returning id into round_id;

  insert into public.answers (
    round_id,
    room_player_id,
    category,
    answer_text,
    verdict,
    points
  ) values (
    round_id,
    owner_id,
    'Animal',
    'Antelope',
    'valid',
    10
  )
  returning id into answer_id;

  begin
    perform public.open_answer_dispute_command(
      room_id,
      round_id,
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
  where id = round_id;

  dispute_id := public.open_answer_dispute_command(
    room_id,
    round_id,
    answer_id,
    opener_id,
    opener_device
  );

  perform public.cast_answer_dispute_vote_command(
    room_id,
    round_id,
    dispute_id,
    owner_id,
    owner_device,
    'valid'
  );

  perform public.cast_answer_dispute_vote_command(
    room_id,
    round_id,
    dispute_id,
    opener_id,
    opener_device,
    'valid'
  );

  resolution := public.resolve_answer_dispute_command(
    room_id,
    round_id,
    dispute_id,
    opener_id,
    opener_device
  );

  assert resolution ->> 'resolved' = 'true', 'Dispute did not resolve';
  assert resolution ->> 'final_verdict' = 'valid', 'Unexpected dispute verdict';
  assert (
    select status = 'resolved' and final_verdict = 'valid'
    from public.answer_disputes
    where id = dispute_id
  ), 'Resolved dispute row was not persisted correctly';
end $$;

rollback;
