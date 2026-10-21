-- Keep the legacy reviewable-validation state separate from the v2 scoring
-- contract. `answers.verdict = disputed` remains valid for the legacy review
-- and enrichment lifecycle; v2 represents unresolved scoring through its
-- pending/dispute state and only permits canonical verdicts in its CHECK.
create or replace function public.live_brawl_v2_canonical_verdict(p_verdict text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_verdict
    when 'valid' then 'valid'
    when 'duplicate' then 'duplicate'
    when 'variant' then 'variant'
    when 'invalid' then 'invalid'
    else 'blank'
  end;
$$;

-- Re-declare only the server-owned materializer so legacy reviewable verdicts
-- cannot cross the v1/v2 contract boundary. The CHECK constraint stays strict.
create or replace function public.materialize_live_brawl_scoring(p_room_id uuid, p_round_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  room_row public.rooms%rowtype;
  round_row public.rounds%rowtype;
  bot_snapshot jsonb;
  human record;
  actor_row record;
  category_value text;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  select * into round_row from public.rounds where id = p_round_id and room_id = p_room_id for update;
  if room_row.id is null or round_row.id is null then raise exception 'Live Brawl room or round not found' using errcode = 'P0002'; end if;
  if room_row.room_visibility <> 'public' or room_row.max_players <> 5 then raise exception 'Live Brawl scoring requires a five-seat public room' using errcode = '55000'; end if;
  if round_row.status not in ('revealing', 'scored') then raise exception 'Live Brawl scoring is not open' using errcode = '55000'; end if;
  if room_row.ruleset_version < 2 then raise exception 'Live Brawl scoring v2 is not enabled for this room' using errcode = '55000'; end if;

  insert into public.live_brawl_rules(room_id) values (p_room_id) on conflict (room_id) do nothing;
  if room_row.bot_count > 0 then
    bot_snapshot := public.get_online_bot_round_snapshot(p_room_id, p_round_id);
  end if;

  for human in
    select id, display_name, row_number() over (order by joined_at, id) - 1 as seat_index
    from public.room_players
    where room_id = p_room_id and role = 'player' and status in ('active', 'disconnected')
    order by joined_at, id
  loop
    insert into public.live_brawl_actors(room_id, actor_key, actor_kind, room_player_id, seat_index, display_name)
    values (p_room_id, 'human:' || human.id::text, 'human', human.id, human.seat_index, human.display_name)
    on conflict (room_id, actor_key) do update set display_name = excluded.display_name;
  end loop;

  for human in select generate_series(1, room_row.bot_count) as bot_index loop
    insert into public.live_brawl_actors(room_id, actor_key, actor_kind, bot_index, seat_index, display_name)
    values (p_room_id, 'bot-' || human.bot_index, 'bot', human.bot_index,
      (select count(*) from public.live_brawl_actors where room_id = p_room_id and actor_kind = 'human') + human.bot_index - 1,
      coalesce((bot_snapshot->'bots'->(human.bot_index - 1)->>'playerName'), 'Bot ' || human.bot_index))
    on conflict (room_id, actor_key) do update set display_name = excluded.display_name;
  end loop;

  for actor_row in select * from public.live_brawl_actors where room_id = p_room_id order by seat_index loop
    foreach category_value in array room_row.categories loop
      if actor_row.actor_kind = 'human' then
        insert into public.live_brawl_answer_targets(room_id, round_id, actor_id, category, answer_text, canonical_verdict, verdict, points, answer_source)
        select p_room_id, p_round_id, actor_row.id, category_value,
          coalesce(a.answer_text, ''), public.live_brawl_v2_canonical_verdict(a.verdict::text), public.live_brawl_v2_canonical_verdict(a.verdict::text), coalesce(a.points, 0), 'human'
        from (select 1) seed
        left join public.answers a on a.round_id = p_round_id and a.room_player_id = actor_row.room_player_id and a.category = category_value
        on conflict (round_id, actor_id, category) do update set answer_text = excluded.answer_text, canonical_verdict = excluded.canonical_verdict;
      else
        insert into public.live_brawl_answer_targets(room_id, round_id, actor_id, category, answer_text, canonical_verdict, verdict, points, answer_source)
        select p_room_id, p_round_id, actor_row.id, category_value,
          coalesce(entry->>'answer', ''), public.live_brawl_v2_canonical_verdict(entry->>'verdict'), public.live_brawl_v2_canonical_verdict(entry->>'verdict'), coalesce((entry->>'points')::integer, 0), 'bot'
        from jsonb_array_elements(coalesce(bot_snapshot->'bots'->(actor_row.bot_index - 1)->'answers', '[]'::jsonb)) entry
        where entry->>'category' = category_value
        on conflict (round_id, actor_id, category) do update set answer_text = excluded.answer_text, canonical_verdict = excluded.canonical_verdict;
      end if;
    end loop;
  end loop;

  insert into public.live_brawl_score_assignments(room_id, round_id, answer_target_id, scorer_actor_id, scoring_ends_at)
  select p_room_id, p_round_id, t.id, next_actor.id,
    coalesce(round_row.scoring_ends_at, round_row.ends_at, clock_timestamp())
  from public.live_brawl_answer_targets t
  join public.live_brawl_actors owner_actor on owner_actor.id = t.actor_id
  join public.live_brawl_actors next_actor on next_actor.room_id = p_room_id
    and next_actor.seat_index = ((owner_actor.seat_index + 1) % (select count(*) from public.live_brawl_actors where room_id = p_room_id))
  where t.round_id = p_round_id
  on conflict (answer_target_id) do nothing;

  insert into public.live_brawl_score_decisions(room_id, round_id, assignment_id, scorer_actor_id, verdict, source)
  select p_room_id, p_round_id, assignment.id, assignment.scorer_actor_id,
    case when nullif(trim(target.answer_text), '') is null then 'no_score'
      when get_byte(decode(md5(target.id::text || rules.bot_seed), 'hex'), 0) % 100 < 20 then 'duplicate'
      else 'valid' end, 'bot'
  from public.live_brawl_score_assignments assignment
  join public.live_brawl_answer_targets target on target.id = assignment.answer_target_id
  join public.live_brawl_actors scorer on scorer.id = assignment.scorer_actor_id and scorer.actor_kind = 'bot'
  join public.live_brawl_rules rules on rules.room_id = p_room_id
  where assignment.round_id = p_round_id
  on conflict (assignment_id) do nothing;

  update public.live_brawl_answer_targets target
  set verdict = decision.verdict, points = public.live_brawl_points(p_room_id, decision.verdict), status = 'scored', updated_at = now()
  from public.live_brawl_score_decisions decision
  where decision.assignment_id in (select id from public.live_brawl_score_assignments where round_id = p_round_id)
    and decision.assignment_id = (select id from public.live_brawl_score_assignments where answer_target_id = target.id)
    and decision.source = 'bot';
  update public.live_brawl_score_assignments set status = 'scored', completed_at = now()
  where round_id = p_round_id and status = 'pending' and id in (select assignment_id from public.live_brawl_score_decisions);
  perform public.refresh_live_brawl_round_scores(p_room_id, p_round_id);

  return jsonb_build_object(
    'roomId', p_room_id,
    'roundId', p_round_id,
    'actorCount', (select count(*) from public.live_brawl_actors where room_id = p_room_id),
    'targetCount', (select count(*) from public.live_brawl_answer_targets where round_id = p_round_id),
    'assignmentCount', (select count(*) from public.live_brawl_score_assignments where round_id = p_round_id),
    'botDecisionCount', (select count(*) from public.live_brawl_score_decisions where round_id = p_round_id and source = 'bot')
  );
end;
$$;
