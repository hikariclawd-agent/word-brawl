-- Server-authoritative command boundary for competitive answer submissions.
-- This is intentionally additive: the mobile app can adopt it before direct
-- answer writes are revoked in a later hardening migration.

alter table public.rooms
  add column if not exists match_revision bigint not null default 0,
  add column if not exists ruleset_version integer not null default 1;

create table if not exists public.match_commands (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  room_player_id uuid not null references public.room_players(id) on delete cascade,
  command_id uuid not null,
  command_type text not null,
  expected_revision bigint not null,
  applied_revision bigint,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (room_id, command_id),
  check (command_type in ('submit_answers')),
  check (expected_revision >= 0),
  check (applied_revision is null or applied_revision >= 0)
);

create index if not exists match_commands_room_revision_idx
  on public.match_commands (room_id, applied_revision);

alter table public.match_commands enable row level security;

revoke all on public.match_commands from anon, authenticated;

create or replace function public.submit_answer_command(
  p_room_id uuid,
  p_room_player_id uuid,
  p_device_player_id text,
  p_command_id uuid,
  p_expected_revision bigint,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row public.rooms%rowtype;
  player_row public.room_players%rowtype;
  round_row public.rounds%rowtype;
  existing_command public.match_commands%rowtype;
  next_revision bigint;
  answer_entry record;
begin
  if jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers must be a JSON object.' using errcode = '22023';
  end if;

  select * into existing_command
  from public.match_commands
  where room_id = p_room_id and command_id = p_command_id;

  if found then
    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'revision', existing_command.applied_revision
    );
  end if;

  select * into room_row
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;

  if room_row.status <> 'in_round' then
    raise exception 'The room is not accepting answers.' using errcode = '55000';
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

  select * into round_row
  from public.rounds
  where room_id = p_room_id
    and status = 'active'
  order by round_number desc
  limit 1;

  if not found then
    raise exception 'No active round exists.' using errcode = '55000';
  end if;

  if round_row.ends_at is not null and round_row.ends_at <= now() then
    raise exception 'The round timer has expired.' using errcode = '57014';
  end if;

  for answer_entry in
    select key as category, value as answer_text
    from jsonb_each_text(p_answers)
  loop
    if char_length(answer_entry.category) not between 1 and 40 then
      raise exception 'Invalid category.' using errcode = '22023';
    end if;

    if char_length(answer_entry.answer_text) > 120 then
      raise exception 'Answer is too long.' using errcode = '22001';
    end if;

    insert into public.answers (
      round_id,
      room_player_id,
      category,
      answer_text,
      submitted_at,
      locked_at
    ) values (
      round_row.id,
      p_room_player_id,
      answer_entry.category,
      answer_entry.answer_text,
      now(),
      now()
    )
    on conflict (round_id, room_player_id, category)
    do update set
      answer_text = excluded.answer_text,
      submitted_at = excluded.submitted_at,
      locked_at = excluded.locked_at,
      updated_at = now();
  end loop;

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
    'submit_answers',
    p_expected_revision,
    next_revision,
    p_answers
  );

  update public.rooms
  set match_revision = next_revision
  where id = p_room_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'revision', next_revision,
    'round_id', round_row.id
  );
end;
$$;

comment on function public.submit_answer_command(uuid, uuid, text, uuid, bigint, jsonb)
is 'Authoritative, idempotent answer submission with player/device membership and room revision checks.';

grant execute on function public.submit_answer_command(uuid, uuid, text, uuid, bigint, jsonb)
  to anon, authenticated;
