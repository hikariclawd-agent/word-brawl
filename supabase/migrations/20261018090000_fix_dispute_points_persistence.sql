-- Keep the player-facing scoring model as the default for newly created rooms.
-- Existing rooms may still carry the legacy verdict-keyed map, so the trigger
-- accepts both shapes without rewriting any stored room or score data.

alter table public.rooms
  alter column scoring_rules
  set default '{"unique":10,"shared":5,"no_score":0}'::jsonb;

create or replace function public.apply_server_answer_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rules jsonb;
  room_id_value uuid;
  configured_points integer;
begin
  select r.room_id into room_id_value
  from public.rounds r
  where r.id = new.round_id;

  select scoring_rules into rules
  from public.rooms
  where id = room_id_value;

  configured_points := case new.verdict
    when 'valid' then coalesce(
      nullif(rules ->> 'unique', '')::integer,
      nullif(rules ->> 'valid', '')::integer
    )
    when 'duplicate' then coalesce(
      nullif(rules ->> 'shared', '')::integer,
      nullif(rules ->> 'duplicate', '')::integer
    )
    when 'variant' then coalesce(
      nullif(rules ->> 'no_score', '')::integer,
      nullif(rules ->> 'variant', '')::integer
    )
    when 'invalid' then coalesce(
      nullif(rules ->> 'no_score', '')::integer,
      nullif(rules ->> 'invalid', '')::integer
    )
    else coalesce(
      nullif(rules ->> 'no_score', '')::integer,
      nullif(rules ->> 'blank', '')::integer
    )
  end;

  new.points := greatest(0, least(100, coalesce(configured_points, 0)));
  return new;
end;
$$;

comment on column public.rooms.scoring_rules is
  'Server-owned scoring map. New rooms use unique/shared/no_score; legacy verdict keys remain supported.';

create or replace function public.resolve_answer_dispute_command(
  p_room_id uuid,
  p_round_id uuid,
  p_dispute_id uuid,
  p_resolver_player_id uuid,
  p_device_player_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  room_row public.rooms%rowtype;
  player_row public.room_players%rowtype;
  dispute_row public.answer_disputes%rowtype;
  answer_row public.answers%rowtype;
  active_player_count integer;
  received_vote_count integer;
  bot_count integer;
  resolved_verdict public.answer_verdict;
  requested_answer_points integer;
  persisted_answer_points integer;
  answered_count integer;
  invalid_streak integer;
  score integer;
begin
  select * into room_row
  from public.rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found.' using errcode = 'P0002';
  end if;

  select * into player_row
  from public.room_players
  where id = p_resolver_player_id
    and room_id = p_room_id
    and device_player_id = p_device_player_id
    and role = 'player'
    and status = 'active';

  if not found then
    raise exception 'Player is not active in this room.' using errcode = '42501';
  end if;

  select d.* into dispute_row
  from public.answer_disputes d
  join public.rounds r on r.id = d.round_id
  where d.id = p_dispute_id
    and d.round_id = p_round_id
    and r.room_id = p_room_id
  for update;

  if not found then
    raise exception 'Dispute is not in this room.' using errcode = '55000';
  end if;

  select * into answer_row
  from public.answers
  where id = dispute_row.answer_id
    and round_id = p_round_id
  for update;

  if not found then
    raise exception 'Disputed answer not found.' using errcode = 'P0002';
  end if;

  if dispute_row.status = 'resolved' then
    select rs.score into score
    from public.round_scores rs
    where rs.round_id = p_round_id
      and rs.room_player_id = answer_row.room_player_id;

    return jsonb_build_object(
      'accepted', true,
      'dispute_id', p_dispute_id,
      'resolved', true,
      'final_verdict', dispute_row.final_verdict::text,
      'points', answer_row.points,
      'score', score
    );
  end if;

  select count(*)::integer into active_player_count
  from public.room_players
  where room_id = p_room_id
    and role = 'player'
    and status = 'active';

  select count(distinct v.voter_player_id)::integer into received_vote_count
  from public.answer_dispute_votes v
  join public.room_players rp on rp.id = v.voter_player_id
  where v.dispute_id = p_dispute_id
    and rp.room_id = p_room_id
    and rp.role = 'player'
    and rp.status = 'active';

  if received_vote_count < active_player_count then
    return jsonb_build_object(
      'accepted', true,
      'dispute_id', p_dispute_id,
      'resolved', false,
      'received_votes', received_vote_count,
      'expected_votes', active_player_count
    );
  end if;

  bot_count := greatest(coalesce(room_row.bot_count, 0), 0);

  with all_votes as (
    select v.verdict::text as verdict
    from public.answer_dispute_votes v
    join public.room_players rp on rp.id = v.voter_player_id
    where v.dispute_id = p_dispute_id
      and rp.room_id = p_room_id
      and rp.role = 'player'
      and rp.status = 'active'
    union all
    select case mod(abs(hashtext(p_dispute_id::text || ':' || bot_index)::bigint), 3)
      when 0 then 'valid'
      when 1 then 'variant'
      else 'invalid'
    end
    from generate_series(1, bot_count) as bot_index
  ),
  tally as (
    select verdict, count(*)::integer as vote_count
    from all_votes
    group by verdict
  )
  select verdict::public.answer_verdict into resolved_verdict
  from tally
  order by vote_count desc, verdict asc
  limit 1;

  if resolved_verdict is null then
    raise exception 'No dispute votes received.' using errcode = '55000';
  end if;

  requested_answer_points := case resolved_verdict
    when 'valid' then 10
    when 'duplicate' then 5
    when 'variant' then 5
    else 0
  end;

  update public.answers
  set verdict = resolved_verdict,
      points = requested_answer_points,
      updated_at = now()
  where id = answer_row.id
  returning points into persisted_answer_points;

  update public.answer_disputes
  set final_verdict = resolved_verdict::text::public.vote_verdict,
      resolved_at = now(),
      status = 'resolved'
  where id = p_dispute_id;

  select count(*) filter (where answer_text <> '')::integer,
         coalesce(sum(points), 0)::integer,
         count(*) filter (where verdict = 'invalid')::integer
  into answered_count, score, invalid_streak
  from public.answers
  where round_id = p_round_id
    and room_player_id = answer_row.room_player_id;

  insert into public.round_scores (
    round_id,
    room_player_id,
    answered_count,
    score,
    invalid_streak,
    penalty_points
  ) values (
    p_round_id,
    answer_row.room_player_id,
    answered_count,
    score,
    invalid_streak,
    0
  )
  on conflict (round_id, room_player_id)
  do update set
    answered_count = excluded.answered_count,
    score = excluded.score,
    invalid_streak = excluded.invalid_streak,
    penalty_points = excluded.penalty_points;

  return jsonb_build_object(
    'accepted', true,
    'dispute_id', p_dispute_id,
    'resolved', true,
    'final_verdict', resolved_verdict::text,
    'points', persisted_answer_points,
    'score', score
  );
end;
$$;

revoke execute on function public.resolve_answer_dispute_command(uuid, uuid, uuid, uuid, text)
  from anon, authenticated;

grant execute on function public.resolve_answer_dispute_command(uuid, uuid, uuid, uuid, text)
  to anon, authenticated;
