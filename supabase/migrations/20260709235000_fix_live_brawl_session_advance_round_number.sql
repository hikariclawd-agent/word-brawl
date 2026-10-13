create or replace function public.advance_live_brawl_session(
  p_room_id uuid,
  p_player_id uuid,
  p_letter text,
  p_round_seconds integer default 60,
  p_target_players integer default 8
)
returns table (
  room_status public.room_status,
  bot_count integer,
  round_id uuid,
  letter text,
  round_number integer,
  ends_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room public.rooms%rowtype;
  v_active_player_count integer;
  v_next_bot_count integer;
  v_next_round_number integer;
  v_now timestamptz := now();
  v_round public.rounds%rowtype;
begin
  if p_target_players is null or p_target_players < 2 or p_target_players > 8 then
    raise exception 'Invalid Live Brawl target size.';
  end if;

  if p_round_seconds is null or p_round_seconds < 30 or p_round_seconds > 300 then
    raise exception 'Invalid round length.';
  end if;

  if p_letter is null or p_letter !~ '^[A-Z]$' then
    raise exception 'Invalid round letter.';
  end if;

  select *
  into v_room
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Session not found.';
  end if;

  if v_room.room_visibility <> 'public' then
    raise exception 'Only Live Brawl sessions can be advanced automatically.';
  end if;

  if v_room.expires_at <= v_now then
    update public.rooms
    set ended_at = v_now,
        status = 'expired'
    where id = p_room_id;

    return query select 'expired'::public.room_status, coalesce(v_room.bot_count, 0), null::uuid, null::text, null::integer, null::timestamptz;
    return;
  end if;

  if not exists (
    select 1
    from public.room_players
    where id = p_player_id
      and room_id = p_room_id
      and role = 'player'
      and status = 'active'
  ) then
    raise exception 'Player is not active in this session.';
  end if;

  if v_room.status <> 'lobby' then
    select *
    into v_round
    from public.rounds
    where room_id = p_room_id
      and status in ('active', 'revealing')
    order by public.rounds.round_number desc
    limit 1;

    return query select v_room.status, coalesce(v_room.bot_count, 0), v_round.id, v_round.letter, v_round.round_number, v_round.ends_at;
    return;
  end if;

  select count(*)::integer
  into v_active_player_count
  from public.room_players
  where room_id = p_room_id
    and role = 'player'
    and status = 'active';

  v_next_bot_count := coalesce(v_room.bot_count, 0);

  if v_active_player_count + v_next_bot_count < p_target_players then
    v_next_bot_count := least(
      7,
      greatest(0, p_target_players - v_active_player_count),
      v_next_bot_count + 1
    );
  end if;

  if v_next_bot_count <> coalesce(v_room.bot_count, 0) then
    update public.rooms
    set bot_count = v_next_bot_count
    where id = p_room_id;
  end if;

  if v_active_player_count + v_next_bot_count < p_target_players then
    return query select 'lobby'::public.room_status, v_next_bot_count, null::uuid, null::text, null::integer, null::timestamptz;
    return;
  end if;

  select coalesce(max(public.rounds.round_number), 0) + 1
  into v_next_round_number
  from public.rounds
  where room_id = p_room_id;

  insert into public.rounds (
    ends_at,
    letter,
    room_id,
    round_number,
    started_by_player_id,
    starts_at,
    status
  )
  values (
    v_now + make_interval(secs => p_round_seconds),
    p_letter,
    p_room_id,
    v_next_round_number,
    p_player_id,
    v_now,
    'active'
  )
  returning *
  into v_round;

  update public.rooms
  set bot_count = v_next_bot_count,
      round_seconds = p_round_seconds,
      started_at = coalesce(started_at, v_now),
      status = 'in_round'
  where id = p_room_id;

  return query select 'in_round'::public.room_status, v_next_bot_count, v_round.id, v_round.letter, v_round.round_number, v_round.ends_at;
end;
$$;
