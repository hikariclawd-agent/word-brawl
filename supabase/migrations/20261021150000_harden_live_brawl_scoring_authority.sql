-- Harden the v2 scoring surface before staging deployment.
-- Internal materialization, bot evaluation, score refresh, points lookup, and
-- dispute resolution are server-only helpers. Player-facing commands retain
-- capability and phase checks.

create or replace function public.enforce_live_brawl_room_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare room_row public.rooms%rowtype; expected_actors integer;
begin
  select * into room_row from public.rooms where id = new.room_id;
  expected_actors := (select count(*)::integer from public.room_players
                      where room_id = new.room_id and role = 'player' and status in ('active', 'disconnected'))
                     + coalesce(room_row.bot_count, 0);
  if room_row.id is null or room_row.max_players <> 5 or cardinality(room_row.categories) <> 4 or expected_actors <> 5 then
    raise exception 'Live Brawl scoring requires exactly five actors and four categories' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger live_brawl_room_contract_guard
before insert or update on public.live_brawl_actors
for each row execute function public.enforce_live_brawl_room_contract();

create or replace function public.open_live_brawl_dispute_command(
  p_room_id uuid, p_round_id uuid, p_answer_target_id uuid, p_room_player_id uuid,
  p_device_player_id text, p_command_id uuid
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  owner_actor public.live_brawl_actors%rowtype;
  target_row public.live_brawl_answer_targets%rowtype;
  dispute_row public.live_brawl_disputes%rowtype;
  round_row public.rounds%rowtype;
  actor_row record;
begin
  perform public.require_room_capability(
    p_room_id, p_room_player_id, p_device_player_id,
    (select capability from public.room_player_capabilities where player_id = p_room_player_id), false
  );
  select * into round_row from public.rounds
  where id = p_round_id and room_id = p_room_id and status in ('revealing', 'scored');
  if round_row.id is null or clock_timestamp() > coalesce(round_row.dispute_ends_at, round_row.ends_at, clock_timestamp()) then
    raise exception 'Dispute window is closed' using errcode = '55000';
  end if;
  select * into owner_actor from public.live_brawl_actors
  where room_id = p_room_id and room_player_id = p_room_player_id and actor_kind = 'human';
  select * into target_row from public.live_brawl_answer_targets
  where id = p_answer_target_id and room_id = p_room_id and round_id = p_round_id;
  if owner_actor.id is null or target_row.actor_id <> owner_actor.id then
    raise exception 'Only the answer owner may challenge this score' using errcode = '42501';
  end if;
  if target_row.status <> 'scored' then
    raise exception 'Only scored answers may be challenged' using errcode = '55000';
  end if;
  select * into dispute_row from public.live_brawl_disputes where answer_target_id = p_answer_target_id;
  if dispute_row.id is not null then
    return jsonb_build_object('accepted', true, 'duplicate', true, 'disputeId', dispute_row.id);
  end if;
  insert into public.live_brawl_disputes(
    room_id, round_id, answer_target_id, opened_by_actor_id, dispute_ends_at, reason
  ) values (
    p_room_id, p_round_id, p_answer_target_id, owner_actor.id,
    coalesce(round_row.dispute_ends_at, round_row.ends_at, clock_timestamp()), 'human challenge'
  ) returning * into dispute_row;
  for actor_row in
    select id, actor_kind from public.live_brawl_actors
    where room_id = p_room_id and id <> owner_actor.id
  loop
    if actor_row.actor_kind = 'bot' then
      insert into public.live_brawl_dispute_votes(dispute_id, voter_actor_id, verdict, source)
      values (dispute_row.id, actor_row.id, case when target_row.canonical_verdict = 'blank' then 'no_score' else target_row.canonical_verdict end, 'bot')
      on conflict do nothing;
    end if;
  end loop;
  return jsonb_build_object('accepted', true, 'duplicate', false, 'disputeId', dispute_row.id);
end;
$$;

create or replace function public.cast_live_brawl_dispute_vote_command(
  p_room_id uuid, p_dispute_id uuid, p_room_player_id uuid, p_device_player_id text,
  p_command_id uuid, p_verdict text
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare actor_row public.live_brawl_actors%rowtype; dispute_row public.live_brawl_disputes%rowtype;
begin
  perform public.require_room_capability(
    p_room_id, p_room_player_id, p_device_player_id,
    (select capability from public.room_player_capabilities where player_id = p_room_player_id), false
  );
  select * into actor_row from public.live_brawl_actors
  where room_id = p_room_id and room_player_id = p_room_player_id and actor_kind = 'human';
  select * into dispute_row from public.live_brawl_disputes
  where id = p_dispute_id and room_id = p_room_id for update;
  if actor_row.id is null or dispute_row.id is null or actor_row.id = dispute_row.opened_by_actor_id then
    raise exception 'Dispute vote denied' using errcode = '42501';
  end if;
  if dispute_row.status <> 'open' or clock_timestamp() > dispute_row.dispute_ends_at then
    raise exception 'Dispute is closed' using errcode = '55000';
  end if;
  if p_verdict not in ('valid', 'duplicate', 'variant', 'invalid', 'no_score') then
    raise exception 'Invalid dispute verdict' using errcode = '22023';
  end if;
  insert into public.live_brawl_dispute_votes(dispute_id, voter_actor_id, verdict, source, command_id)
  values (p_dispute_id, actor_row.id, p_verdict, 'human', p_command_id)
  on conflict (dispute_id, voter_actor_id) do update set verdict = excluded.verdict;
  return jsonb_build_object('accepted', true, 'disputeId', p_dispute_id);
end;
$$;

create or replace function public.evaluate_live_brawl_bot_challenges(p_room_id uuid, p_round_id uuid)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  target_row record;
  dispute_id uuid;
  inserted_count integer := 0;
  actor_row record;
  rules_row public.live_brawl_rules%rowtype;
  bot_vote text;
begin
  select * into rules_row from public.live_brawl_rules where room_id = p_room_id;
  for target_row in
    select t.*, a.id as owner_id
    from public.live_brawl_answer_targets t
    join public.live_brawl_actors a on a.id = t.actor_id
    where t.room_id = p_room_id and t.round_id = p_round_id and a.actor_kind = 'bot' and t.status = 'scored'
  loop
    if get_byte(decode(md5(target_row.id::text || rules_row.bot_seed || ':challenge'), 'hex'), 0) % 100 >= rules_row.bot_challenge_percent then
      continue;
    end if;
    bot_vote := case when target_row.canonical_verdict = 'blank' then 'no_score' else target_row.canonical_verdict end;
    insert into public.live_brawl_disputes(room_id, round_id, answer_target_id, opened_by_actor_id, dispute_ends_at, reason)
    values (
      p_room_id, p_round_id, target_row.id, target_row.owner_id,
      coalesce((select dispute_ends_at from public.rounds where id = p_round_id), clock_timestamp()),
      'deterministic bot challenge'
    ) on conflict (answer_target_id) do nothing returning id into dispute_id;
    if dispute_id is not null then
      inserted_count := inserted_count + 1;
      for actor_row in
        select id from public.live_brawl_actors
        where room_id = p_room_id and id <> target_row.owner_id and actor_kind = 'bot'
      loop
        insert into public.live_brawl_dispute_votes(dispute_id, voter_actor_id, verdict, source)
        values (dispute_id, actor_row.id, bot_vote, 'bot') on conflict do nothing;
      end loop;
    end if;
  end loop;
  return inserted_count;
end;
$$;

revoke all on function public.materialize_live_brawl_scoring(uuid, uuid) from public, anon, authenticated;
revoke all on function public.evaluate_live_brawl_bot_challenges(uuid, uuid) from public, anon, authenticated;
revoke all on function public.refresh_live_brawl_round_scores(uuid, uuid) from public, anon, authenticated;
revoke all on function public.live_brawl_points(uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_live_brawl_dispute_command(uuid, uuid) from public, anon, authenticated;
