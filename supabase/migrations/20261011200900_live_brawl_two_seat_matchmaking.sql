-- Keep Live Brawl matchmaking aligned with the two-seat round advance rule.

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
  target_players integer;
begin
  target_players := least(8, greatest(2, coalesce((p_options->>'maxPlayers')::int, 2)));

  perform pg_advisory_xact_lock(hashtextextended(p_options->>'matchmakingBucket', 0));

  for r in
    select *
    from rooms
    where room_visibility = 'public'
      and expires_at > clock_timestamp()
      and status not in ('finished', 'expired')
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

      if cap is not null and (p.status = 'active' or (p.status = 'disconnected' and p.left_at > clock_timestamp() - interval '12 seconds')) then
        update room_players
        set status = 'active',
            left_at = null,
            last_seen_at = clock_timestamp(),
            display_name = trim(p_display_name)
        where id = p.id;

        return jsonb_build_object('roomId', r.id, 'playerId', p.id, 'capability', cap);
      end if;

      continue;
    end if;

    if r.status = 'lobby'
      and r.started_at is null
      and r.created_at + interval '650 milliseconds' > clock_timestamp()
      and (
        select count(*)
        from room_players
        where room_id = r.id
          and role = 'player'
          and (status = 'active' or (status = 'disconnected' and left_at > clock_timestamp() - interval '12 seconds'))
      ) + r.bot_count < target_players
    then
      insert into room_players(room_id, device_player_id, display_name)
      values(r.id, p_device_player_id, trim(p_display_name))
      returning * into p;

      insert into room_player_capabilities(player_id, room_id, device_player_id)
      values(p.id, r.id, p_device_player_id)
      returning capability into cap;

      return jsonb_build_object('roomId', r.id, 'playerId', p.id, 'capability', cap);
    end if;
  end loop;

  return create_managed_room(
    p_device_player_id,
    p_display_name,
    p_settings || '{"bot_count":0}',
    p_options || jsonb_build_object(
      'visibility', 'public',
      'maxPlayers', target_players,
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
begin
  select * into r
  from rooms
  where id = new.room_id
  for update;

  if r.room_visibility = 'public' and new.role = 'player' then
    if r.status <> 'lobby'
      or r.started_at is not null
      or r.created_at + interval '650 milliseconds' <= clock_timestamp()
      or (
        select count(*)
        from room_players
        where room_id = r.id
          and role = 'player'
          and (status = 'active' or (status = 'disconnected' and left_at > clock_timestamp() - interval '12 seconds'))
      ) + r.bot_count >= r.max_players
    then
      raise exception 'Live Brawl seats are locked';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.find_or_create_public_room(text, text, jsonb, jsonb, jsonb) from public;
grant execute on function public.find_or_create_public_room(text, text, jsonb, jsonb, jsonb) to anon, authenticated;
