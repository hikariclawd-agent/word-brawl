-- Server-authoritative timeout finalisation for Live Brawl.
-- Additive: clients can call this when a phase expires without relying on
-- local timers to submit or vote on time.

alter table public.rounds
  add column if not exists scoring_ends_at timestamptz,
  add column if not exists dispute_ends_at timestamptz;

alter table public.match_commands
  drop constraint if exists match_commands_command_type_check;

alter table public.match_commands
  add constraint match_commands_command_type_check
  check (command_type in ('submit_answers', 'cast_vote', 'finalize_timeout'));

create or replace function public.live_brawl_auto_vote(
  p_answer_text text,
  p_category text,
  p_letter text
)
returns public.vote_verdict
language plpgsql
stable
set search_path = public
as $$
begin
  if trim(coalesce(p_answer_text, '')) = '' then
    return 'invalid'::public.vote_verdict;
  end if;

  if p_letter is not null and upper(left(trim(p_answer_text), 1)) <> p_letter then
    return 'invalid'::public.vote_verdict;
  end if;

  if exists (
    select 1
    from public.bot_word_bank bw
    where bw.category = p_category
      and lower(regexp_replace(bw.word, '[^a-zA-Z]', '', 'g'))
        = lower(regexp_replace(p_answer_text, '[^a-zA-Z]', '', 'g'))
  ) then
    return 'valid'::public.vote_verdict;
  end if;

  -- Unknown but plausible words stay playable. Timeout automation should not
  -- punish an answer only because the local word bank is incomplete.
  return 'valid'::public.vote_verdict;
end;
$$;

create or replace function public.refresh_live_brawl_round_score(
  p_round_id uuid,
  p_room_player_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  answered_count_value integer;
  score_value integer;
  invalid_streak_value integer;
begin
  select count(*) filter (where answer_text <> '')::integer,
         coalesce(sum(points), 0)::integer,
         count(*) filter (where verdict = 'invalid')::integer
  into answered_count_value, score_value, invalid_streak_value
  from public.answers
  where round_id = p_round_id
    and room_player_id = p_room_player_id;

  insert into public.round_scores (
    round_id,
    room_player_id,
    answered_count,
    score,
    invalid_streak,
    penalty_points
  ) values (
    p_round_id,
    p_room_player_id,
    coalesce(answered_count_value, 0),
    coalesce(score_value, 0),
    coalesce(invalid_streak_value, 0),
    0
  )
  on conflict (round_id, room_player_id)
  do update set
    answered_count = excluded.answered_count,
    score = excluded.score,
    invalid_streak = excluded.invalid_streak,
    penalty_points = excluded.penalty_points;
end;
$$;

create or replace function public.finalize_live_brawl_timeout_command(
  p_room_id uuid,
  p_round_id uuid,
  p_room_player_id uuid,
  p_device_player_id text,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  player_row public.room_players%rowtype;
  existing_command public.match_commands%rowtype;
  next_revision bigint;
  phase_value text := 'complete';
  active_player_count integer;
  answer_row public.answers%rowtype;
  dispute_row public.answer_disputes%rowtype;
  resolved_verdict public.answer_verdict;
  expected_vote_count integer;
  received_vote_count integer;
  changed_count integer;
  did_change boolean := false;
begin
  select * into existing_command
  from public.match_commands
  where room_id = p_room_id and command_id = p_command_id;

  if found then
    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'revision', existing_command.applied_revision,
      'phase', existing_command.payload ->> 'phase'
    );
  end if;

  select * into room_row
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
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
  where id = p_round_id
    and room_id = p_room_id
  for update;

  if not found then
    raise exception 'Round not found.' using errcode = 'P0002';
  end if;

  select count(*)::integer into active_player_count
  from public.room_players
  where room_id = p_room_id
    and role = 'player'
    and status = 'active';

  if active_player_count <= 0 then
    raise exception 'No active players remain in this room.' using errcode = '55000';
  end if;

  if round_row.status = 'active' then
    if round_row.ends_at is null or round_row.ends_at > clock_timestamp() then
      raise exception 'Answering phase has not expired.' using errcode = '57014';
    end if;

    phase_value := 'answering';

    insert into public.answers (
      round_id,
      room_player_id,
      category,
      answer_text,
      verdict,
      submitted_at,
      locked_at
    )
    select
      round_row.id,
      rp.id,
      category_value,
      '',
      'blank'::public.answer_verdict,
      clock_timestamp(),
      clock_timestamp()
    from public.room_players rp
    cross join unnest(room_row.categories) as category_value
    where rp.room_id = p_room_id
      and rp.role = 'player'
      and rp.status = 'active'
      and not exists (
        select 1
        from public.answers a
        where a.round_id = round_row.id
          and a.room_player_id = rp.id
          and a.category = category_value
      );
    get diagnostics changed_count = row_count;
    did_change := did_change or changed_count > 0;

    update public.rounds
    set status = 'revealing',
        revealed_at = coalesce(revealed_at, clock_timestamp()),
        scoring_ends_at = coalesce(scoring_ends_at, clock_timestamp() + interval '45 seconds'),
        dispute_ends_at = coalesce(dispute_ends_at, clock_timestamp() + interval '75 seconds')
    where id = round_row.id
      and status = 'active';
    get diagnostics changed_count = row_count;
    did_change := did_change or changed_count > 0;

    update public.rooms
    set status = 'revealing'
    where id = p_room_id
      and status <> 'revealing';
    get diagnostics changed_count = row_count;
    did_change := did_change or changed_count > 0;

    perform public.refresh_live_brawl_round_score(round_row.id, rp.id)
    from public.room_players rp
    where rp.room_id = p_room_id
      and rp.role = 'player'
      and rp.status = 'active';
  else
    if round_row.status <> 'revealing' then
      raise exception 'Round is not in a timeout-finalisable phase.' using errcode = '55000';
    end if;

    if coalesce(round_row.scoring_ends_at, round_row.revealed_at + interval '45 seconds', clock_timestamp()) > clock_timestamp()
      and coalesce(round_row.dispute_ends_at, round_row.revealed_at + interval '75 seconds', clock_timestamp()) > clock_timestamp() then
      return jsonb_build_object(
        'accepted', true,
        'duplicate', true,
        'revision', room_row.match_revision,
        'round_id', p_round_id,
        'phase', 'answering'
      );
    end if;

    phase_value := case
      when exists(select 1 from public.answer_disputes where round_id = round_row.id and status = 'open') then 'dispute'
      else 'scoring'
    end;

    for answer_row in
      select *
      from public.answers
      where round_id = round_row.id
        and answer_text <> ''
      for update
    loop
      insert into public.votes (answer_id, voter_player_id, verdict)
      select
        answer_row.id,
        rp.id,
        public.live_brawl_auto_vote(answer_row.answer_text, answer_row.category, round_row.letter)
      from public.room_players rp
      where rp.room_id = p_room_id
        and rp.role = 'player'
        and rp.status = 'active'
        and rp.id <> answer_row.room_player_id
        and not exists (
          select 1
          from public.votes v
          where v.answer_id = answer_row.id
            and v.voter_player_id = rp.id
        );
      get diagnostics changed_count = row_count;
      did_change := did_change or changed_count > 0;

      select count(*)::integer into expected_vote_count
      from public.room_players rp
      where rp.room_id = p_room_id
        and rp.role = 'player'
        and rp.status = 'active'
        and rp.id <> answer_row.room_player_id;

      select count(*)::integer into received_vote_count
      from public.votes v
      join public.room_players rp on rp.id = v.voter_player_id
      where v.answer_id = answer_row.id
        and rp.room_id = p_room_id
        and rp.role = 'player'
        and rp.status = 'active'
        and rp.id <> answer_row.room_player_id;

      if expected_vote_count = 0 then
        resolved_verdict := public.live_brawl_auto_vote(answer_row.answer_text, answer_row.category, round_row.letter)::text::public.answer_verdict;
      elsif received_vote_count >= expected_vote_count then
        select v.verdict::text::public.answer_verdict into resolved_verdict
        from public.votes v
        join public.room_players rp on rp.id = v.voter_player_id
        where v.answer_id = answer_row.id
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
            updated_at = clock_timestamp()
        where id = answer_row.id
          and verdict is distinct from resolved_verdict;
        get diagnostics changed_count = row_count;
        did_change := did_change or changed_count > 0;
      end if;

      resolved_verdict := null;
      perform public.refresh_live_brawl_round_score(round_row.id, answer_row.room_player_id);
    end loop;

    for dispute_row in
      select *
      from public.answer_disputes
      where round_id = round_row.id
        and status = 'open'
      for update
    loop
      insert into public.answer_dispute_votes (dispute_id, voter_player_id, verdict)
      select
        dispute_row.id,
        rp.id,
        public.live_brawl_auto_vote(a.answer_text, a.category, round_row.letter)
      from public.room_players rp
      join public.answers a on a.id = dispute_row.answer_id
      where rp.room_id = p_room_id
        and rp.role = 'player'
        and rp.status = 'active'
        and not exists (
          select 1
          from public.answer_dispute_votes dv
          where dv.dispute_id = dispute_row.id
            and dv.voter_player_id = rp.id
        );
      get diagnostics changed_count = row_count;
      did_change := did_change or changed_count > 0;

      with all_votes as (
        select verdict::text as verdict
        from public.answer_dispute_votes
        where dispute_id = dispute_row.id
        union all
        select case mod(abs(hashtext(dispute_row.id::text || ':' || bot_index)::bigint), 3)
          when 0 then 'valid'
          when 1 then 'variant'
          else 'invalid'
        end
        from generate_series(1, greatest(coalesce(room_row.bot_count, 0), 0)) as bot_index
      )
      select verdict::public.answer_verdict into resolved_verdict
      from all_votes
      group by verdict
      order by count(*) desc, verdict asc
      limit 1;

      update public.answers
      set verdict = resolved_verdict,
          updated_at = clock_timestamp()
      where id = dispute_row.answer_id
        and verdict is distinct from resolved_verdict;
      get diagnostics changed_count = row_count;
      did_change := did_change or changed_count > 0;

      update public.answer_disputes
      set final_verdict = resolved_verdict::text::public.vote_verdict,
          resolved_at = clock_timestamp(),
          status = 'resolved'
      where id = dispute_row.id
        and status <> 'resolved';
      get diagnostics changed_count = row_count;
      did_change := did_change or changed_count > 0;

      perform public.refresh_live_brawl_round_score(round_row.id, a.room_player_id)
      from public.answers a
      where a.id = dispute_row.answer_id;

      resolved_verdict := null;
    end loop;
  end if;

  if not did_change then
    return jsonb_build_object(
      'accepted', true,
      'duplicate', true,
      'revision', room_row.match_revision,
      'round_id', p_round_id,
      'phase', phase_value
    );
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
    'finalize_timeout',
    room_row.match_revision,
    next_revision,
    jsonb_build_object('round_id', p_round_id, 'phase', phase_value)
  );

  update public.rooms
  set match_revision = next_revision
  where id = p_room_id;

  return jsonb_build_object(
    'accepted', true,
    'duplicate', false,
    'revision', next_revision,
    'round_id', p_round_id,
    'phase', phase_value
  );
end;
$$;

grant execute on function public.finalize_live_brawl_timeout_command(uuid, uuid, uuid, text, uuid)
  to anon, authenticated;
