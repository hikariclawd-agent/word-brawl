-- Require authoritative answer submissions to match the room's configured
-- categories. Missing categories are stored as blanks; unknown categories are
-- rejected so forged payload keys cannot count as a real submission.

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
  category_value text;
  unknown_category text;
  active_player_count integer;
  submitted_player_count integer;
  revealed boolean := false;
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
      'revision', existing_command.applied_revision,
      'round_id', existing_command.payload ->> 'round_id'
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

  if room_row.categories is null or array_length(room_row.categories, 1) is null then
    raise exception 'Room has no answer categories.' using errcode = '55000';
  end if;

  select key into unknown_category
  from jsonb_object_keys(p_answers) as key
  where not (key = any(room_row.categories))
  limit 1;

  if unknown_category is not null then
    raise exception 'Invalid category.' using errcode = '22023';
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
  limit 1
  for update;

  if not found then
    raise exception 'No active round exists.' using errcode = '55000';
  end if;

  if round_row.ends_at is not null and round_row.ends_at <= clock_timestamp() then
    raise exception 'The round timer has expired.' using errcode = '57014';
  end if;

  foreach category_value in array room_row.categories loop
    if char_length(category_value) not between 1 and 40 then
      raise exception 'Invalid category.' using errcode = '22023';
    end if;

    if char_length(coalesce(p_answers ->> category_value, '')) > 120 then
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
      category_value,
      btrim(coalesce(p_answers ->> category_value, '')),
      clock_timestamp(),
      clock_timestamp()
    )
    on conflict (round_id, room_player_id, category)
    do update set
      answer_text = excluded.answer_text,
      submitted_at = excluded.submitted_at,
      locked_at = excluded.locked_at,
      updated_at = clock_timestamp();
  end loop;

  perform public.refresh_live_brawl_round_score(round_row.id, p_room_player_id);

  select count(*)::integer into active_player_count
  from public.room_players
  where room_id = p_room_id
    and role = 'player'
    and status = 'active';

  select count(distinct a.room_player_id)::integer into submitted_player_count
  from public.answers a
  join public.room_players rp on rp.id = a.room_player_id
  where a.round_id = round_row.id
    and rp.room_id = p_room_id
    and rp.role = 'player'
    and rp.status = 'active'
    and not exists (
      select 1
      from unnest(room_row.categories) as required_category
      where not exists (
        select 1
        from public.answers required_answer
        where required_answer.round_id = round_row.id
          and required_answer.room_player_id = rp.id
          and required_answer.category = required_category
      )
    );

  if active_player_count > 0 and submitted_player_count >= active_player_count then
    update public.rounds
    set status = 'revealing',
        revealed_at = coalesce(revealed_at, clock_timestamp()),
        scoring_ends_at = coalesce(scoring_ends_at, clock_timestamp() + interval '45 seconds'),
        dispute_ends_at = coalesce(dispute_ends_at, clock_timestamp() + interval '75 seconds')
    where id = round_row.id
      and status = 'active';

    update public.rooms
    set status = 'revealing'
    where id = p_room_id
      and status = 'in_round';

    revealed := true;
  end if;

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
    jsonb_build_object('answers', p_answers, 'revealed', revealed, 'round_id', round_row.id)
  );

  update public.rooms
  set match_revision = next_revision
  where id = p_room_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'revision', next_revision,
    'revealed', revealed,
    'round_id', round_row.id
  );
end;
$$;

grant execute on function public.submit_answer_command(uuid, uuid, text, uuid, bigint, jsonb)
  to anon, authenticated;
