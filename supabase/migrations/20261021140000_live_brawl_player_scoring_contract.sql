-- Live Brawl v2 player-to-player scoring contract.
-- Additive by design: legacy answers/votes/disputes remain the compatibility path.

create table public.live_brawl_rules (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  scoring_version integer not null default 2 check (scoring_version >= 2),
  bot_scoring_mode text not null default 'deterministic' check (bot_scoring_mode in ('deterministic')),
  bot_challenge_percent integer not null default 25 check (bot_challenge_percent between 0 and 100),
  bot_seed text not null default 'live-brawl-v2',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.live_brawl_actors (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  actor_key text not null,
  actor_kind text not null check (actor_kind in ('human', 'bot')),
  room_player_id uuid references public.room_players(id) on delete cascade,
  bot_index integer,
  seat_index integer not null check (seat_index between 0 and 4),
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (room_id, actor_key),
  unique (room_id, seat_index),
  unique (room_id, room_player_id),
  check ((actor_kind = 'human' and room_player_id is not null and bot_index is null)
      or (actor_kind = 'bot' and room_player_id is null and bot_index between 1 and 4))
);

create table public.live_brawl_answer_targets (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  actor_id uuid not null references public.live_brawl_actors(id) on delete cascade,
  category text not null,
  answer_text text not null default '',
  canonical_verdict text not null default 'blank'
    check (canonical_verdict in ('blank', 'valid', 'duplicate', 'variant', 'invalid')),
  verdict text not null default 'blank'
    check (verdict in ('blank', 'valid', 'duplicate', 'variant', 'invalid', 'no_score')),
  points integer not null default 0 check (points >= 0),
  status text not null default 'pending' check (status in ('pending', 'scored', 'disputed', 'resolved')),
  answer_source text not null check (answer_source in ('human', 'bot')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_id, actor_id, category)
);

create table public.live_brawl_score_assignments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  answer_target_id uuid not null unique references public.live_brawl_answer_targets(id) on delete cascade,
  scorer_actor_id uuid not null references public.live_brawl_actors(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'scored', 'timed_out')),
  scoring_ends_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  check (answer_target_id <> scorer_actor_id)
);

create table public.live_brawl_score_decisions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  assignment_id uuid not null unique references public.live_brawl_score_assignments(id) on delete cascade,
  scorer_actor_id uuid not null references public.live_brawl_actors(id) on delete cascade,
  verdict text not null check (verdict in ('valid', 'duplicate', 'variant', 'invalid', 'no_score')),
  source text not null check (source in ('human', 'bot', 'timeout')),
  command_id uuid,
  created_at timestamptz not null default now(),
  unique (room_id, command_id)
);

create table public.live_brawl_disputes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  answer_target_id uuid not null references public.live_brawl_answer_targets(id) on delete cascade,
  opened_by_actor_id uuid not null references public.live_brawl_actors(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'resolved', 'timed_out')),
  final_verdict text check (final_verdict in ('valid', 'duplicate', 'variant', 'invalid', 'no_score')),
  reason text,
  opened_at timestamptz not null default now(),
  dispute_ends_at timestamptz not null,
  resolved_at timestamptz,
  unique (answer_target_id)
);

create table public.live_brawl_dispute_votes (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.live_brawl_disputes(id) on delete cascade,
  voter_actor_id uuid not null references public.live_brawl_actors(id) on delete cascade,
  verdict text not null check (verdict in ('valid', 'duplicate', 'variant', 'invalid', 'no_score')),
  source text not null check (source in ('human', 'bot', 'timeout')),
  command_id uuid,
  created_at timestamptz not null default now(),
  unique (dispute_id, voter_actor_id),
  unique (dispute_id, command_id)
);

create table public.live_brawl_round_scores (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_id uuid not null references public.rounds(id) on delete cascade,
  actor_id uuid not null references public.live_brawl_actors(id) on delete cascade,
  answered_count integer not null default 0 check (answered_count >= 0),
  score integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (round_id, actor_id)
);

create unique index live_brawl_disputes_one_open_idx
  on public.live_brawl_disputes(answer_target_id) where status = 'open';
create index live_brawl_targets_round_idx on public.live_brawl_answer_targets(round_id, actor_id);
create index live_brawl_assignments_round_idx on public.live_brawl_score_assignments(round_id, scorer_actor_id);
create index live_brawl_decisions_round_idx on public.live_brawl_score_decisions(round_id);

create or replace function public.enforce_live_brawl_assignment_owner()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1
    from public.live_brawl_answer_targets target
    where target.id = new.answer_target_id
      and target.actor_id = new.scorer_actor_id
  ) then
    raise exception 'Live Brawl assignments cannot self-score' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger live_brawl_assignment_owner_guard
before insert or update on public.live_brawl_score_assignments
for each row execute function public.enforce_live_brawl_assignment_owner();

alter table public.live_brawl_rules enable row level security;
alter table public.live_brawl_actors enable row level security;
alter table public.live_brawl_answer_targets enable row level security;
alter table public.live_brawl_score_assignments enable row level security;
alter table public.live_brawl_score_decisions enable row level security;
alter table public.live_brawl_disputes enable row level security;
alter table public.live_brawl_dispute_votes enable row level security;
alter table public.live_brawl_round_scores enable row level security;

grant select on
  public.live_brawl_rules,
  public.live_brawl_actors,
  public.live_brawl_answer_targets,
  public.live_brawl_score_assignments,
  public.live_brawl_score_decisions,
  public.live_brawl_disputes,
  public.live_brawl_dispute_votes,
  public.live_brawl_round_scores
to anon, authenticated;

create policy "live brawl scoring read" on public.live_brawl_rules for select using (true);
create policy "live brawl actor read" on public.live_brawl_actors for select using (true);
create policy "live brawl target read" on public.live_brawl_answer_targets for select using (true);
create policy "live brawl assignment read" on public.live_brawl_score_assignments for select using (true);
create policy "live brawl decision read" on public.live_brawl_score_decisions for select using (true);
create policy "live brawl dispute read" on public.live_brawl_disputes for select using (true);
create policy "live brawl dispute vote read" on public.live_brawl_dispute_votes for select using (true);
create policy "live brawl round score read" on public.live_brawl_round_scores for select using (true);

create or replace function public.live_brawl_points(p_room_id uuid, p_verdict text)
returns integer
language sql stable security definer set search_path = public
as $$
  select case p_verdict
    when 'valid' then coalesce((scoring_rules->>'unique')::integer, 10)
    when 'duplicate' then coalesce((scoring_rules->>'shared')::integer, 5)
    when 'variant' then coalesce((scoring_rules->>'shared')::integer, 5)
    else coalesce((scoring_rules->>'no_score')::integer, 0)
  end
  from public.rooms where id = p_room_id;
$$;

create or replace function public.configure_live_brawl_scoring(
  p_room_id uuid, p_room_player_id uuid, p_device_player_id text, p_capability uuid,
  p_bot_challenge_percent integer default 25, p_bot_seed text default 'live-brawl-v2'
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  perform public.require_room_capability(p_room_id, p_room_player_id, p_device_player_id, p_capability, true);
  if not exists (select 1 from public.rooms where id=p_room_id and room_visibility='public' and status='lobby') then
    raise exception 'Live Brawl scoring configuration is locked' using errcode='55000';
  end if;
  if p_bot_challenge_percent not between 0 and 100 or nullif(trim(p_bot_seed), '') is null then
    raise exception 'Invalid Live Brawl scoring configuration' using errcode='22023';
  end if;
  insert into public.live_brawl_rules(room_id, bot_challenge_percent, bot_seed)
  values (p_room_id, p_bot_challenge_percent, trim(p_bot_seed))
  on conflict (room_id) do update set bot_challenge_percent=excluded.bot_challenge_percent, bot_seed=excluded.bot_seed, updated_at=now();
  return jsonb_build_object('roomId',p_room_id,'botChallengePercent',p_bot_challenge_percent,'botSeed',trim(p_bot_seed));
end;
$$;

create or replace function public.refresh_live_brawl_round_scores(p_room_id uuid, p_round_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.live_brawl_round_scores(room_id, round_id, actor_id, answered_count, score)
  select p_room_id, p_round_id, a.id,
    count(t.id) filter (where nullif(trim(t.answer_text), '') is not null)::integer,
    coalesce(sum(t.points) filter (where t.status in ('scored', 'disputed', 'resolved')), 0)::integer
  from public.live_brawl_actors a
  left join public.live_brawl_answer_targets t on t.actor_id = a.id and t.round_id = p_round_id
  where a.room_id = p_room_id
  group by a.id
  on conflict (round_id, actor_id) do update set
    answered_count = excluded.answered_count,
    score = excluded.score,
    updated_at = now();
end;
$$;

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
  target_row record;
  category_value text;
  scorer_id uuid;
  scorer_kind text;
  bot_verdict text;
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

  -- Seat order is authoritative and stable: human join order, then bot index.
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
          coalesce(a.answer_text, ''), coalesce(a.verdict::text, 'blank'), coalesce(a.verdict::text, 'blank'), coalesce(a.points, 0), 'human'
        from (select 1) seed
        left join public.answers a on a.round_id = p_round_id and a.room_player_id = actor_row.room_player_id and a.category = category_value
        on conflict (round_id, actor_id, category) do update set answer_text = excluded.answer_text, canonical_verdict = excluded.canonical_verdict;
      else
        insert into public.live_brawl_answer_targets(room_id, round_id, actor_id, category, answer_text, canonical_verdict, verdict, points, answer_source)
        select p_room_id, p_round_id, actor_row.id, category_value,
          coalesce(entry->>'answer', ''), coalesce(entry->>'verdict', 'blank'), coalesce(entry->>'verdict', 'blank'), coalesce((entry->>'points')::integer, 0), 'bot'
        from jsonb_array_elements(coalesce(bot_snapshot->'bots'->(actor_row.bot_index - 1)->'answers', '[]'::jsonb)) entry
        where entry->>'category' = category_value
        on conflict (round_id, actor_id, category) do update set answer_text = excluded.answer_text, canonical_verdict = excluded.canonical_verdict;
      end if;
    end loop;
  end loop;

  insert into public.live_brawl_score_assignments(room_id, round_id, answer_target_id, scorer_actor_id, scoring_ends_at)
  select p_room_id, p_round_id, t.id,
    next_actor.id,
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
      else 'valid' end,
    'bot'
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

create or replace function public.complete_live_brawl_round_command(
  p_room_id uuid, p_round_id uuid, p_room_player_id uuid, p_device_player_id text,
  p_capability uuid, p_command_id uuid, p_expected_revision bigint, p_finish_match boolean default false
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare room_row public.rooms%rowtype; round_row public.rounds%rowtype; existing public.match_commands%rowtype;
  assignment_row record; dispute_row record; next_picker_id uuid; next_revision bigint;
begin
  select * into existing from public.match_commands where room_id=p_room_id and command_id=p_command_id;
  if existing.id is not null then return jsonb_build_object('accepted',true,'duplicate',true,'revision',existing.applied_revision,'round_id',p_round_id); end if;
  select * into room_row from public.rooms where id=p_room_id for update;
  perform public.require_room_capability(p_room_id,p_room_player_id,p_device_player_id,p_capability,true);
  if room_row.match_revision <> p_expected_revision then raise exception 'Stale match revision' using errcode='40001'; end if;
  select * into round_row from public.rounds where id=p_round_id and room_id=p_room_id for update;
  if round_row.id is null or round_row.status <> 'revealing' then raise exception 'Round is not ready to complete' using errcode='55000'; end if;
  perform public.materialize_live_brawl_scoring(p_room_id,p_round_id);

  -- A disconnected or inactive human cannot deadlock the round after the server deadline.
  if clock_timestamp() >= coalesce(round_row.scoring_ends_at, round_row.ends_at, clock_timestamp()) then
    for assignment_row in
      select a.* from public.live_brawl_score_assignments a
      where a.round_id=p_round_id and a.status='pending'
    loop
      insert into public.live_brawl_score_decisions(room_id,round_id,assignment_id,scorer_actor_id,verdict,source)
      values(p_room_id,p_round_id,assignment_row.id,assignment_row.scorer_actor_id,'no_score','timeout')
      on conflict (assignment_id) do nothing;
      update public.live_brawl_answer_targets set verdict='no_score',points=0,status='scored',updated_at=now() where id=assignment_row.answer_target_id;
      update public.live_brawl_score_assignments set status='timed_out',completed_at=now() where id=assignment_row.id;
    end loop;
  end if;
  perform public.evaluate_live_brawl_bot_challenges(p_room_id,p_round_id);
  for dispute_row in select id from public.live_brawl_disputes where room_id=p_room_id and round_id=p_round_id and status='open' loop
    perform public.resolve_live_brawl_dispute_command(p_room_id,dispute_row.id);
  end loop;
  if exists(select 1 from public.live_brawl_score_assignments where round_id=p_round_id and status='pending')
     or exists(select 1 from public.live_brawl_disputes where round_id=p_round_id and status='open') then
    raise exception 'Live Brawl scoring or disputes are not complete' using errcode='55000';
  end if;
  perform public.refresh_live_brawl_round_scores(p_room_id,p_round_id);
  if not p_finish_match then
    select p.id into next_picker_id from public.room_players p
    where p.room_id=p_room_id and p.role='player' and p.status='active'
    order by p.joined_at,p.id limit 1;
  end if;
  update public.rounds set status='scored',scored_at=clock_timestamp() where id=p_round_id;
  update public.rooms set status=case when p_finish_match then 'finished'::public.room_status else 'lobby'::public.room_status end,
    ended_at=case when p_finish_match then clock_timestamp() else null end,
    letter_picker_player_id=next_picker_id,match_revision=match_revision+1 where id=p_room_id returning match_revision into next_revision;
  insert into public.match_commands(room_id,room_player_id,command_id,command_type,expected_revision,applied_revision,payload)
  values(p_room_id,p_room_player_id,p_command_id,'complete_round',p_expected_revision,next_revision,jsonb_build_object('live_scoring_version',2,'round_id',p_round_id,'finish_match',p_finish_match));
  return jsonb_build_object('accepted',true,'duplicate',false,'revision',next_revision,'round_id',p_round_id,'finish_match',p_finish_match);
end; $$;

create or replace function public.cast_live_brawl_score_command(
  p_room_id uuid, p_round_id uuid, p_assignment_id uuid, p_room_player_id uuid,
  p_device_player_id text, p_command_id uuid, p_expected_revision bigint, p_verdict text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare assignment_row public.live_brawl_score_assignments%rowtype; scorer_row public.live_brawl_actors%rowtype;
  target_row public.live_brawl_answer_targets%rowtype; existing public.live_brawl_score_decisions%rowtype; room_row public.rooms%rowtype;
begin
  select * into existing from public.live_brawl_score_decisions where room_id = p_room_id and command_id = p_command_id;
  if existing.id is not null then return jsonb_build_object('accepted', true, 'duplicate', true, 'decisionId', existing.id); end if;
  select * into room_row from public.rooms where id = p_room_id for update;
  perform public.materialize_live_brawl_scoring(p_room_id, p_round_id);
  if room_row.match_revision <> p_expected_revision then raise exception 'Stale match revision' using errcode = '40001'; end if;
  select * into scorer_row from public.live_brawl_actors where room_id = p_room_id and room_player_id = p_room_player_id and actor_kind = 'human';
  if scorer_row.id is null then raise exception 'Human actor is not active in this Live Brawl' using errcode = '42501'; end if;
  perform public.require_room_capability(p_room_id, p_room_player_id, p_device_player_id, (select capability from room_player_capabilities where player_id = p_room_player_id), false);
  select * into assignment_row from public.live_brawl_score_assignments where id = p_assignment_id and room_id = p_room_id and round_id = p_round_id for update;
  if assignment_row.id is null or assignment_row.scorer_actor_id <> scorer_row.id then raise exception 'Scoring assignment denied' using errcode = '42501'; end if;
  if assignment_row.status <> 'pending' or clock_timestamp() > assignment_row.scoring_ends_at then raise exception 'Scoring assignment is closed' using errcode = '55000'; end if;
  select * into target_row from public.live_brawl_answer_targets where id = assignment_row.answer_target_id for update;
  if target_row.actor_id = scorer_row.id then raise exception 'Self-scoring is not allowed' using errcode = '22023'; end if;
  if p_verdict not in ('valid', 'duplicate', 'variant', 'invalid', 'no_score') then raise exception 'Invalid score verdict' using errcode = '22023'; end if;
  insert into public.live_brawl_score_decisions(room_id, round_id, assignment_id, scorer_actor_id, verdict, source, command_id)
  values (p_room_id, p_round_id, assignment_row.id, scorer_row.id, p_verdict, 'human', p_command_id);
  update public.live_brawl_answer_targets set verdict = p_verdict, points = public.live_brawl_points(p_room_id, p_verdict), status = 'scored', updated_at = now() where id = target_row.id;
  update public.live_brawl_score_assignments set status = 'scored', completed_at = now() where id = assignment_row.id;
  update public.rooms set match_revision = match_revision + 1 where id = p_room_id;
  perform public.refresh_live_brawl_round_scores(p_room_id, p_round_id);
  return jsonb_build_object('accepted', true, 'duplicate', false, 'decisionId', (select id from public.live_brawl_score_decisions where command_id = p_command_id));
end; $$;

create or replace function public.open_live_brawl_dispute_command(
  p_room_id uuid, p_round_id uuid, p_answer_target_id uuid, p_room_player_id uuid,
  p_device_player_id text, p_command_id uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare owner_actor public.live_brawl_actors%rowtype; target_row public.live_brawl_answer_targets%rowtype; dispute_row public.live_brawl_disputes%rowtype; room_row public.rooms%rowtype; actor_row record;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  select * into owner_actor from public.live_brawl_actors where room_id = p_room_id and room_player_id = p_room_player_id and actor_kind = 'human';
  select * into target_row from public.live_brawl_answer_targets where id = p_answer_target_id and room_id = p_room_id and round_id = p_round_id;
  if owner_actor.id is null or target_row.actor_id <> owner_actor.id then raise exception 'Only the answer owner may challenge this score' using errcode = '42501'; end if;
  if target_row.status <> 'scored' then raise exception 'Only scored answers may be challenged' using errcode = '55000'; end if;
  select * into dispute_row from public.live_brawl_disputes where answer_target_id = p_answer_target_id;
  if dispute_row.id is not null then return jsonb_build_object('accepted', true, 'duplicate', true, 'disputeId', dispute_row.id); end if;
  insert into public.live_brawl_disputes(room_id, round_id, answer_target_id, opened_by_actor_id, dispute_ends_at, reason)
  values (p_room_id, p_round_id, p_answer_target_id, owner_actor.id, coalesce((select dispute_ends_at from rounds where id=p_round_id), clock_timestamp()), 'human challenge') returning * into dispute_row;
  for actor_row in select id, actor_kind from public.live_brawl_actors where room_id = p_room_id and id <> owner_actor.id loop
    if actor_row.actor_kind = 'bot' then
      insert into public.live_brawl_dispute_votes(dispute_id, voter_actor_id, verdict, source)
      values (dispute_row.id, actor_row.id, target_row.canonical_verdict, 'bot') on conflict do nothing;
    end if;
  end loop;
  return jsonb_build_object('accepted', true, 'duplicate', false, 'disputeId', dispute_row.id);
end; $$;

create or replace function public.evaluate_live_brawl_bot_challenges(p_room_id uuid, p_round_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare target_row record; dispute_id uuid; inserted_count integer := 0; actor_row record; rules_row public.live_brawl_rules%rowtype;
begin
  select * into rules_row from public.live_brawl_rules where room_id = p_room_id;
  for target_row in
    select t.*, a.id as owner_id from public.live_brawl_answer_targets t join public.live_brawl_actors a on a.id=t.actor_id
    where t.room_id=p_room_id and t.round_id=p_round_id and a.actor_kind='bot' and t.status='scored'
  loop
    if get_byte(decode(md5(target_row.id::text || rules_row.bot_seed || ':challenge'), 'hex'), 0) % 100 >= rules_row.bot_challenge_percent then continue; end if;
    insert into public.live_brawl_disputes(room_id, round_id, answer_target_id, opened_by_actor_id, dispute_ends_at, reason)
    values (p_room_id, p_round_id, target_row.id, target_row.owner_id, coalesce((select dispute_ends_at from rounds where id=p_round_id), clock_timestamp()), 'deterministic bot challenge') on conflict (answer_target_id) do nothing returning id into dispute_id;
    if dispute_id is not null then
      inserted_count := inserted_count + 1;
      for actor_row in select id from public.live_brawl_actors where room_id=p_room_id and id <> target_row.owner_id and actor_kind='bot' loop
        insert into public.live_brawl_dispute_votes(dispute_id, voter_actor_id, verdict, source) values(dispute_id, actor_row.id, target_row.canonical_verdict, 'bot') on conflict do nothing;
      end loop;
    end if;
  end loop;
  return inserted_count;
end; $$;

create or replace function public.cast_live_brawl_dispute_vote_command(
  p_room_id uuid, p_dispute_id uuid, p_room_player_id uuid, p_device_player_id text,
  p_command_id uuid, p_verdict text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare actor_row public.live_brawl_actors%rowtype; dispute_row public.live_brawl_disputes%rowtype;
begin
  select * into actor_row from public.live_brawl_actors where room_id=p_room_id and room_player_id=p_room_player_id and actor_kind='human';
  select * into dispute_row from public.live_brawl_disputes where id=p_dispute_id and room_id=p_room_id for update;
  if actor_row.id is null or dispute_row.id is null or actor_row.id = dispute_row.opened_by_actor_id then raise exception 'Dispute vote denied' using errcode='42501'; end if;
  if dispute_row.status <> 'open' or clock_timestamp() > dispute_row.dispute_ends_at then raise exception 'Dispute is closed' using errcode='55000'; end if;
  if p_verdict not in ('valid','duplicate','variant','invalid','no_score') then raise exception 'Invalid dispute verdict' using errcode='22023'; end if;
  insert into public.live_brawl_dispute_votes(dispute_id, voter_actor_id, verdict, source, command_id)
  values(p_dispute_id, actor_row.id, p_verdict, 'human', p_command_id)
  on conflict (dispute_id, voter_actor_id) do update set verdict=excluded.verdict;
  return jsonb_build_object('accepted',true,'disputeId',p_dispute_id);
end; $$;

create or replace function public.resolve_live_brawl_dispute_command(p_room_id uuid, p_dispute_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare d public.live_brawl_disputes%rowtype; target_row public.live_brawl_answer_targets%rowtype; eligible integer; received integer; final_value text;
begin
  select * into d from public.live_brawl_disputes where id=p_dispute_id and room_id=p_room_id for update;
  if d.id is null then raise exception 'Dispute not found' using errcode='P0002'; end if;
  if d.status <> 'open' then return jsonb_build_object('accepted',true,'resolved',true,'disputeId',d.id,'verdict',d.final_verdict); end if;
  select count(*)::integer into eligible from public.live_brawl_actors where room_id=p_room_id and id <> d.opened_by_actor_id;
  select count(*)::integer into received from public.live_brawl_dispute_votes where dispute_id=d.id;
  if received < eligible and clock_timestamp() < d.dispute_ends_at then return jsonb_build_object('accepted',true,'resolved',false,'receivedVotes',received,'expectedVotes',eligible); end if;
  select v.verdict into final_value from public.live_brawl_dispute_votes v where v.dispute_id=d.id group by v.verdict order by count(*) desc, v.verdict asc limit 1;
  select * into target_row from public.live_brawl_answer_targets where id=d.answer_target_id for update;
  final_value := coalesce(final_value, target_row.verdict, 'no_score');
  update public.live_brawl_disputes set status=case when received < eligible then 'timed_out' else 'resolved' end, final_verdict=final_value, resolved_at=clock_timestamp() where id=d.id;
  update public.live_brawl_answer_targets set verdict=final_value, points=public.live_brawl_points(p_room_id, final_value), status='resolved', updated_at=now() where id=target_row.id;
  perform public.refresh_live_brawl_round_scores(p_room_id, d.round_id);
  return jsonb_build_object('accepted',true,'resolved',true,'disputeId',d.id,'verdict',final_value);
end; $$;

revoke all on
  public.live_brawl_rules,
  public.live_brawl_actors,
  public.live_brawl_answer_targets,
  public.live_brawl_score_assignments,
  public.live_brawl_score_decisions,
  public.live_brawl_disputes,
  public.live_brawl_dispute_votes,
  public.live_brawl_round_scores
from anon, authenticated;
grant select on
  public.live_brawl_rules,
  public.live_brawl_actors,
  public.live_brawl_answer_targets,
  public.live_brawl_score_assignments,
  public.live_brawl_score_decisions,
  public.live_brawl_disputes,
  public.live_brawl_dispute_votes,
  public.live_brawl_round_scores
to anon, authenticated;

revoke all on function public.materialize_live_brawl_scoring(uuid, uuid) from public, anon, authenticated;
revoke all on function public.evaluate_live_brawl_bot_challenges(uuid, uuid) from public, anon, authenticated;
revoke all on function public.refresh_live_brawl_round_scores(uuid, uuid) from public, anon, authenticated;
revoke all on function public.live_brawl_points(uuid, text) from public, anon, authenticated;
revoke all on function public.configure_live_brawl_scoring(uuid, uuid, text, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.materialize_live_brawl_scoring(uuid, uuid) to anon, authenticated;
grant execute on function public.evaluate_live_brawl_bot_challenges(uuid, uuid) to anon, authenticated;
grant execute on function public.cast_live_brawl_score_command(uuid, uuid, uuid, uuid, text, uuid, bigint, text) to anon, authenticated;
grant execute on function public.open_live_brawl_dispute_command(uuid, uuid, uuid, uuid, text, uuid) to anon, authenticated;
grant execute on function public.cast_live_brawl_dispute_vote_command(uuid, uuid, uuid, text, uuid, text) to anon, authenticated;
grant execute on function public.resolve_live_brawl_dispute_command(uuid, uuid) to anon, authenticated;
grant execute on function public.complete_live_brawl_round_command(uuid, uuid, uuid, text, uuid, uuid, bigint, boolean) to anon, authenticated;
grant execute on function public.configure_live_brawl_scoring(uuid, uuid, text, uuid, integer, text) to anon, authenticated;

comment on table public.live_brawl_actors is 'Server-owned Live Brawl actors. Bots are not room_players and cannot impersonate a device.';
comment on table public.live_brawl_score_assignments is 'Exactly one persisted scorer per answer target; cyclic seat rotation prevents self-scoring.';
comment on table public.live_brawl_score_decisions is 'Idempotent authoritative human, bot, or timeout score decisions.';
