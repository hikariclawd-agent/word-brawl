-- Restore Live Brawl to five total seats with one 650ms human-search window per seat.
-- Bot seats are permanent once committed; there is no bot replacement path.

alter table public.rooms
add column if not exists live_brawl_seat_window_started_at timestamptz not null default clock_timestamp();

update public.rooms
set live_brawl_seat_window_started_at = coalesce(started_at, updated_at, created_at, clock_timestamp())
where live_brawl_seat_window_started_at is null;

create or replace function public.find_or_create_public_room(
  p_device_player_id text,
  p_display_name text,
  p_settings jsonb,
  p_options jsonb,
  p_capabilities jsonb default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms%rowtype;
  p room_players%rowtype;
  cap uuid;
  t timestamptz;
  active_humans integer;
begin
  t := clock_timestamp();

  perform pg_advisory_xact_lock(hashtextextended(p_options->>'matchmakingBucket', 0));

  for r in
    select *
    from rooms
    where room_visibility = 'public'
      and expires_at > t
      and status = 'lobby'
      and started_at is null
      and matchmaking_bucket = p_options->>'matchmakingBucket'
      and ruleset_version = (p_options->>'rulesetVersion')::int
      and min_client_version = coalesce(p_options->>'minClientVersion', min_client_version)
    order by created_at
    for update
  loop
    select * into p
    from room_players
    where room_id = r.id
      and device_player_id = p_device_player_id;

    if found then
      select capability into cap
      from room_player_capabilities
      where player_id = p.id
        and capability::text = p_capabilities->>p.id::text;

      if cap is not null and (p.status = 'active' or (p.status = 'disconnected' and p.left_at > t - interval '12 seconds')) then
        update room_players
        set status = 'active',
            left_at = null,
            last_seen_at = t,
            display_name = trim(p_display_name)
        where id = p.id;

        return jsonb_build_object('roomId', r.id, 'playerId', p.id, 'capability', cap);
      end if;

      continue;
    end if;

    select count(*) into active_humans
    from room_players
    where room_id = r.id
      and role = 'player'
      and (status = 'active' or (status = 'disconnected' and left_at > t - interval '12 seconds'));

    if active_humans + r.bot_count < 5
      and t < r.live_brawl_seat_window_started_at + interval '650 milliseconds'
    then
      insert into room_players(room_id, device_player_id, display_name)
      values(r.id, p_device_player_id, trim(p_display_name))
      returning * into p;

      insert into room_player_capabilities(player_id, room_id, device_player_id)
      values(p.id, r.id, p_device_player_id)
      returning capability into cap;

      update rooms
      set live_brawl_seat_window_started_at = t
      where id = r.id;

      return jsonb_build_object('roomId', r.id, 'playerId', p.id, 'capability', cap);
    end if;
  end loop;

  return create_managed_room(
    p_device_player_id,
    p_display_name,
    p_settings || '{"bot_count":0}',
    p_options || jsonb_build_object(
      'visibility', 'public',
      'maxPlayers', 5,
      'expiresInMinutes', 10
    )
  );
end;
$$;

create or replace function public.guard_public_room_seat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms%rowtype;
  active_humans integer;
  t timestamptz;
begin
  t := clock_timestamp();

  select * into r
  from rooms
  where id = new.room_id
  for update;

  if r.room_visibility = 'public' and new.role = 'player' then
    select count(*) into active_humans
    from room_players
    where room_id = r.id
      and role = 'player'
      and (status = 'active' or (status = 'disconnected' and left_at > t - interval '12 seconds'));

    if r.status <> 'lobby'
      or r.started_at is not null
      or t >= r.live_brawl_seat_window_started_at + interval '650 milliseconds'
      or active_humans + r.bot_count >= r.max_players
      or r.max_players <> 5
    then
      raise exception 'Live Brawl seats are locked';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.advance_live_brawl_session(
  p_room_id uuid,
  p_player_id uuid,
  p_letter text,
  p_device_player_id text,
  p_capability uuid,
  p_round_seconds integer default 60,
  p_target_players integer default 5
)
returns table(room_status room_status, bot_count integer, round_id uuid, letter text, round_number integer, ends_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms%rowtype;
  rd rounds%rowtype;
  humans integer;
  total_seats integer;
  t timestamptz;
begin
  if p_target_players <> 5 or p_letter !~ '^[A-Z]$' then
    raise exception 'Invalid Live Brawl request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_room_id::text, 0));

  select * into r from rooms where id = p_room_id for update;
  perform require_room_capability(p_room_id, p_player_id, p_device_player_id, p_capability);
  t := clock_timestamp();

  if r.room_visibility <> 'public' then
    raise exception 'Not a public session';
  end if;

  if r.max_players <> 5 then
    raise exception 'Invalid Live Brawl room target';
  end if;

  if r.expires_at <= t then
    raise exception 'Session expired';
  end if;

  if r.status <> 'lobby' then
    select * into rd
    from rounds
    where room_id = r.id and status in ('active', 'revealing')
    order by rounds.round_number desc
    limit 1;

    return query select r.status, r.bot_count, rd.id, rd.letter, rd.round_number, rd.ends_at;
    return;
  end if;

  select count(*) into humans
  from room_players
  where room_id = r.id
    and role = 'player'
    and (status = 'active' or (status = 'disconnected' and left_at > t - interval '12 seconds'));

  total_seats := humans + r.bot_count;

  if total_seats < 5 and t >= r.live_brawl_seat_window_started_at + interval '650 milliseconds' then
    update rooms
    set bot_count = bot_count + 1,
        live_brawl_seat_window_started_at = t
    where id = r.id
      and status = 'lobby'
      and started_at is null
      and bot_count = r.bot_count
      and bot_count + humans < 5
    returning * into r;

    if found then
      total_seats := total_seats + 1;
    end if;
  end if;

  if total_seats < 5 then
    return query select 'lobby'::room_status, r.bot_count, null::uuid, null::text, null::int, null::timestamptz;
    return;
  end if;

  select * into rd
  from rounds
  where room_id = r.id and status in ('active', 'revealing')
  order by rounds.round_number desc
  limit 1;

  if rd.id is null then
    insert into rounds(room_id, round_number, letter, starts_at, ends_at, started_by_player_id, status)
    select r.id, coalesce(max(rounds.round_number), 0) + 1, p_letter, t, t + make_interval(secs => r.round_seconds), p_player_id, 'active'
    from rounds
    where room_id = r.id
    returning * into rd;
  end if;

  update rooms
  set started_at = coalesce(started_at, t),
      status = 'in_round'
  where id = r.id
    and status = 'lobby';

  return query select 'in_round'::room_status, r.bot_count, rd.id, rd.letter, rd.round_number, rd.ends_at;
end;
$$;

revoke all on function public.find_or_create_public_room(text, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.find_or_create_public_room(text, text, jsonb, jsonb, jsonb) to anon, authenticated;

revoke all on function public.advance_live_brawl_session(uuid, uuid, text, text, uuid, integer, integer) from public;
grant execute on function public.advance_live_brawl_session(uuid, uuid, text, text, uuid, integer, integer) to anon, authenticated;
