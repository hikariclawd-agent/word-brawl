-- Allow only the server-designated active letter picker to start subsequent rounds.
-- Management authority remains host-only; existing picker and revision checks stay intact.
create or replace function public.start_online_round_command(
  p_room_id uuid,
  p_room_player_id uuid,
  p_device_player_id text,
  p_capability uuid,
  p_command_id uuid,
  p_expected_revision bigint,
  p_letter text,
  p_round_seconds integer default 90
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  existing_command public.match_commands%rowtype;
  next_revision bigint;
  next_round_number integer;
  started_at_value timestamptz := clock_timestamp();
begin
  if p_letter is null or p_letter !~ '^[A-Z]$' then
    raise exception 'Invalid round letter.' using errcode = '22023';
  end if;

  if p_round_seconds is null or p_round_seconds < 30 or p_round_seconds > 300 then
    raise exception 'Invalid round length.' using errcode = '22023';
  end if;

  select * into existing_command
  from public.match_commands
  where room_id = p_room_id and command_id = p_command_id;

  if found then
    select * into round_row
    from public.rounds
    where id = (existing_command.payload ->> 'round_id')::uuid;

    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'revision', existing_command.applied_revision,
      'round_id', round_row.id,
      'letter', round_row.letter,
      'round_number', round_row.round_number,
      'ends_at', round_row.ends_at
    );
  end if;

  select * into room_row
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;

  -- Starting a round is a picker action, not a room-management action.
  -- Preserve host-only management when no picker has been assigned.
  if room_row.letter_picker_player_id is null then
    perform public.require_room_capability(p_room_id, p_room_player_id, p_device_player_id, p_capability, true);
  else
    perform public.require_room_capability(p_room_id, p_room_player_id, p_device_player_id, p_capability, false);
  end if;

  if room_row.status <> 'lobby' then
    raise exception 'Room is not in the lobby.' using errcode = '55000';
  end if;

  if room_row.expires_at <= started_at_value then
    raise exception 'Room has expired.' using errcode = '57014';
  end if;

  if room_row.letter_picker_player_id is not null
    and room_row.letter_picker_player_id <> p_room_player_id
  then
    raise exception 'This player cannot pick the next letter.' using errcode = '42501';
  end if;

  if room_row.match_revision <> p_expected_revision then
    raise exception 'Stale match revision.' using errcode = '40001';
  end if;

  select coalesce(max(round_number), 0) + 1
  into next_round_number
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
  ) values (
    started_at_value + make_interval(secs => p_round_seconds),
    p_letter,
    p_room_id,
    next_round_number,
    p_room_player_id,
    started_at_value,
    'active'
  )
  returning * into round_row;

  next_revision := room_row.match_revision + 1;

  insert into public.match_commands (
    room_id,
    room_player_id,
    command_id,
    command_type,
    expected_revision,
    applied_revision,
    payload
  ) values (
    p_room_id,
    p_room_player_id,
    p_command_id,
    'start_round',
    p_expected_revision,
    next_revision,
    jsonb_build_object('round_id', round_row.id, 'letter', p_letter)
  );

  update public.rooms
  set match_revision = next_revision,
      started_at = coalesce(started_at, started_at_value),
      status = 'in_round'
  where id = p_room_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'revision', next_revision,
    'round_id', round_row.id,
    'letter', round_row.letter,
    'round_number', round_row.round_number,
    'ends_at', round_row.ends_at
  );
end;
$$;

