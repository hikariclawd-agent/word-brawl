-- Stage 3 server authority hardening.
-- Move round start, answer reveal, and round completion behind locked RPCs,
-- then remove legacy direct write grants for competitive tables.

alter table public.match_commands
  drop constraint if exists match_commands_command_type_check;

alter table public.match_commands
  add constraint match_commands_command_type_check
  check (command_type in ('start_round', 'submit_answers', 'cast_vote', 'finalize_timeout', 'complete_round'));

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

  perform public.require_room_capability(p_room_id, p_room_player_id, p_device_player_id, p_capability, true);

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
    and rp.status = 'active';

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
  resolved_verdict public.answer_verdict;
  expected_votes integer;
  received_votes integer;
  resolved boolean := false;
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
  where id = p_answer_id
  for update;

  if not found then
    raise exception 'Answer not found.' using errcode = 'P0002';
  end if;

  select * into round_row
  from public.rounds
  where id = answer_row.round_id
    and room_id = p_room_id
    and status = 'revealing';

  if not found then
    raise exception 'Answer is not available for voting.' using errcode = '55000';
  end if;

  if answer_row.room_player_id = p_room_player_id then
    raise exception 'Players cannot vote on their own answer.' using errcode = '42501';
  end if;

  insert into public.votes (answer_id, voter_player_id, verdict)
  values (p_answer_id, p_room_player_id, vote_value)
  on conflict (answer_id, voter_player_id)
  do update set verdict = excluded.verdict;

  select count(*)::integer into expected_votes
  from public.room_players
  where room_id = p_room_id
    and role = 'player'
    and status = 'active'
    and id <> answer_row.room_player_id;

  select count(distinct v.voter_player_id)::integer into received_votes
  from public.votes v
  join public.room_players rp on rp.id = v.voter_player_id
  where v.answer_id = p_answer_id
    and rp.room_id = p_room_id
    and rp.role = 'player'
    and rp.status = 'active'
    and rp.id <> answer_row.room_player_id;

  if expected_votes = 0 then
    resolved_verdict := public.live_brawl_auto_vote(answer_row.answer_text, answer_row.category, round_row.letter)::text::public.answer_verdict;
  elsif received_votes >= expected_votes then
    select v.verdict::text::public.answer_verdict into resolved_verdict
    from public.votes v
    join public.room_players rp on rp.id = v.voter_player_id
    where v.answer_id = p_answer_id
      and rp.room_id = p_room_id
      and rp.role = 'player'
      and rp.status = 'active'
      and rp.id <> answer_row.room_player_id
    group by v.verdict
    order by count(*) desc, v.verdict::text asc
    limit 1;
  end if;

  if resolved_verdict is not null then
    update public.answers
    set verdict = resolved_verdict,
        points = case resolved_verdict
          when 'valid' then 10
          when 'duplicate' then 5
          when 'variant' then 5
          else 0
        end,
        updated_at = clock_timestamp()
    where id = p_answer_id;

    perform public.refresh_live_brawl_round_score(round_row.id, answer_row.room_player_id);
    resolved := true;
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
    'answer_id', p_answer_id,
    'resolved', resolved,
    'final_verdict', case when resolved then resolved_verdict::text else null end
  );
end;
$$;

create or replace function public.complete_online_round_command(
  p_room_id uuid,
  p_round_id uuid,
  p_room_player_id uuid,
  p_device_player_id text,
  p_capability uuid,
  p_command_id uuid,
  p_expected_revision bigint,
  p_finish_match boolean default false
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
  active_player_count integer;
  submitted_player_count integer;
  expected_vote_count integer;
  vote_count integer;
  open_dispute_count integer;
  completed_at timestamptz := clock_timestamp();
  current_picker_index integer;
  next_picker_id uuid;
begin
  select * into existing_command
  from public.match_commands
  where room_id = p_room_id and command_id = p_command_id;

  if found then
    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'revision', existing_command.applied_revision,
      'round_id', p_round_id
    );
  end if;

  select * into room_row
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;

  perform public.require_room_capability(p_room_id, p_room_player_id, p_device_player_id, p_capability, true);

  if room_row.match_revision <> p_expected_revision then
    raise exception 'Stale match revision.' using errcode = '40001';
  end if;

  select * into round_row
  from public.rounds
  where id = p_round_id
    and room_id = p_room_id
  for update;

  if not found then
    raise exception 'Round not found.' using errcode = 'P0002';
  end if;

  if round_row.status = 'scored' then
    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'revision', room_row.match_revision,
      'round_id', p_round_id
    );
  end if;

  if round_row.status <> 'revealing' then
    raise exception 'Round is not ready to complete.' using errcode = '55000';
  end if;

  select count(*)::integer into active_player_count
  from public.room_players
  where room_id = p_room_id
    and role = 'player'
    and status = 'active';

  select count(distinct rs.room_player_id)::integer into submitted_player_count
  from public.round_scores rs
  join public.room_players rp on rp.id = rs.room_player_id
  where rs.round_id = p_round_id
    and rp.room_id = p_room_id
    and rp.role = 'player'
    and rp.status = 'active';

  select coalesce(sum(voters.expected_count), 0)::integer into expected_vote_count
  from public.answers a
  cross join lateral (
    select count(*)::integer as expected_count
    from public.room_players rp
    where rp.room_id = p_room_id
      and rp.role = 'player'
      and rp.status = 'active'
      and rp.id <> a.room_player_id
  ) voters
  where a.round_id = p_round_id
    and a.answer_text <> '';

  select count(distinct (v.answer_id, v.voter_player_id))::integer into vote_count
  from public.votes v
  join public.answers a on a.id = v.answer_id
  join public.room_players rp on rp.id = v.voter_player_id
  where a.round_id = p_round_id
    and rp.room_id = p_room_id
    and rp.role = 'player'
    and rp.status = 'active'
    and rp.id <> a.room_player_id;

  select count(*)::integer into open_dispute_count
  from public.answer_disputes
  where round_id = p_round_id
    and status = 'open';

  if active_player_count <= 0
    or submitted_player_count < active_player_count
    or vote_count < expected_vote_count
    or open_dispute_count > 0
  then
    raise exception 'Round is not ready to finish yet.' using errcode = '55000';
  end if;

  if p_finish_match then
    next_picker_id := null;
  else
    with players as (
      select id, row_number() over (order by joined_at, id) as rn, count(*) over () as total
      from public.room_players
      where room_id = p_room_id
        and role = 'player'
        and status = 'active'
    ),
    current_picker as (
      select coalesce((select rn from players where id = room_row.letter_picker_player_id), 1) as rn,
             coalesce((select max(total) from players), 0) as total
    )
    select p.id into next_picker_id
    from players p, current_picker c
    where p.rn = case when c.total <= 0 then 1 else (c.rn % c.total) + 1 end;
  end if;

  update public.rounds
  set scored_at = completed_at,
      status = 'scored'
  where id = p_round_id;

  update public.rooms
  set ended_at = case when p_finish_match then completed_at else null end,
      letter_picker_player_id = next_picker_id,
      status = case when p_finish_match then 'finished'::public.room_status else 'lobby'::public.room_status end
  where id = p_room_id;

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
    'complete_round',
    p_expected_revision,
    next_revision,
    jsonb_build_object('round_id', p_round_id, 'finish_match', p_finish_match)
  );

  update public.rooms
  set match_revision = next_revision
  where id = p_room_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'revision', next_revision,
    'round_id', p_round_id,
    'finish_match', p_finish_match,
    'room_status', case when p_finish_match then 'finished' else 'lobby' end
  );
end;
$$;

revoke all on function public.start_online_round_command(uuid,uuid,text,uuid,uuid,bigint,text,integer) from public;
revoke all on function public.complete_online_round_command(uuid,uuid,uuid,text,uuid,uuid,bigint,boolean) from public;
grant execute on function public.start_online_round_command(uuid,uuid,text,uuid,uuid,bigint,text,integer) to anon, authenticated;
grant execute on function public.complete_online_round_command(uuid,uuid,uuid,text,uuid,uuid,bigint,boolean) to anon, authenticated;

revoke all on
  public.answers,
  public.answer_disputes,
  public.answer_dispute_votes,
  public.rooms,
  public.rounds,
  public.round_scores,
  public.votes
from anon, authenticated;

grant select on
  public.answers,
  public.answer_disputes,
  public.answer_dispute_votes,
  public.rooms,
  public.rounds,
  public.round_scores,
  public.votes
to anon, authenticated;

revoke all on public.room_players from anon, authenticated;
grant select on public.room_players to anon, authenticated;
grant update (display_name, last_seen_at, left_at, status) on public.room_players to anon, authenticated;

grant update (ended_at, empty_since, letter_picker_player_id) on public.rooms to anon, authenticated;
