-- Server-authoritative voting boundary for competitive rounds.
-- Additive until the mobile client has migrated from direct vote writes.

alter table public.match_commands
  drop constraint if exists match_commands_command_type_check;

alter table public.match_commands
  add constraint match_commands_command_type_check
  check (command_type in ('submit_answers', 'cast_vote'));

create or replace function public.submit_answer_vote_command(
  p_room_id uuid,
  p_room_player_id uuid,
  p_device_player_id text,
  p_command_id uuid,
  p_expected_revision bigint,
  p_answer_id uuid,
  p_verdict text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row public.rooms%rowtype;
  player_row public.room_players%rowtype;
  answer_row public.answers%rowtype;
  round_row public.rounds%rowtype;
  existing_command public.match_commands%rowtype;
  next_revision bigint;
  vote_value public.vote_verdict;
begin
  begin
    vote_value := p_verdict::public.vote_verdict;
  exception when invalid_text_representation then
    raise exception 'Invalid vote verdict.' using errcode = '22023';
  end;

  select * into existing_command
  from public.match_commands
  where room_id = p_room_id and command_id = p_command_id;

  if found then
    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'revision', existing_command.applied_revision,
      'answer_id', p_answer_id
    );
  end if;

  select * into room_row
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;

  if room_row.status <> 'revealing' then
    raise exception 'The room is not accepting votes.' using errcode = '55000';
  end if;

  if room_row.match_revision <> p_expected_revision then
    raise exception 'Stale match revision.' using errcode = '40001';
  end if;

  select * into player_row
  from public.room_players
  where id = p_room_player_id
    and room_id = p_room_id
    and device_player_id = p_device_player_id
    and role = 'player'
    and status = 'active';

  if not found then
    raise exception 'Player is not active in this room.' using errcode = '42501';
  end if;

  select * into answer_row
  from public.answers
  where id = p_answer_id;

  select * into round_row
  from public.rounds
  where id = answer_row.round_id
    and room_id = p_room_id
    and status = 'revealing';

  if not found then
    raise exception 'Answer is not available for voting.' using errcode = '55000';
  end if;

  insert into public.votes (answer_id, voter_player_id, verdict)
  values (p_answer_id, p_room_player_id, vote_value)
  on conflict (answer_id, voter_player_id)
  do update set verdict = excluded.verdict;

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
    'cast_vote',
    p_expected_revision,
    next_revision,
    jsonb_build_object('answer_id', p_answer_id, 'verdict', vote_value::text)
  );

  update public.rooms
  set match_revision = next_revision
  where id = p_room_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'revision', next_revision,
    'answer_id', p_answer_id
  );
end;
$$;

comment on function public.submit_answer_vote_command(uuid, uuid, text, uuid, bigint, uuid, text)
is 'Authoritative, idempotent vote submission with room membership, phase, and revision checks.';

grant execute on function public.submit_answer_vote_command(uuid, uuid, text, uuid, bigint, uuid, text)
  to anon, authenticated;
