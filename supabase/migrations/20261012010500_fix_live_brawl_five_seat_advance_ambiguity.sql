-- Qualify room columns in five-seat Live Brawl advance to avoid PL/pgSQL output-column shadowing.

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
    where rounds.room_id = r.id and rounds.status in ('active', 'revealing')
    order by rounds.round_number desc
    limit 1;

    return query select r.status, r.bot_count, rd.id, rd.letter, rd.round_number, rd.ends_at;
    return;
  end if;

  select count(*) into humans
  from room_players
  where room_players.room_id = r.id
    and room_players.role = 'player'
    and (room_players.status = 'active' or (room_players.status = 'disconnected' and room_players.left_at > t - interval '12 seconds'));

  total_seats := humans + r.bot_count;

  if total_seats < 5 and t >= r.live_brawl_seat_window_started_at + interval '650 milliseconds' then
    update rooms
    set bot_count = rooms.bot_count + 1,
        live_brawl_seat_window_started_at = t
    where rooms.id = r.id
      and rooms.status = 'lobby'
      and rooms.started_at is null
      and rooms.bot_count = r.bot_count
      and rooms.bot_count + humans < 5
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
  where rounds.room_id = r.id and rounds.status in ('active', 'revealing')
  order by rounds.round_number desc
  limit 1;

  if rd.id is null then
    insert into rounds(room_id, round_number, letter, starts_at, ends_at, started_by_player_id, status)
    select r.id, coalesce(max(rounds.round_number), 0) + 1, p_letter, t, t + make_interval(secs => r.round_seconds), p_player_id, 'active'
    from rounds
    where rounds.room_id = r.id
    returning * into rd;
  end if;

  update rooms
  set started_at = coalesce(started_at, t),
      status = 'in_round'
  where rooms.id = r.id
    and rooms.status = 'lobby';

  return query select 'in_round'::room_status, r.bot_count, rd.id, rd.letter, rd.round_number, rd.ends_at;
end;
$$;

revoke all on function public.advance_live_brawl_session(uuid, uuid, text, text, uuid, integer, integer) from public;
grant execute on function public.advance_live_brawl_session(uuid, uuid, text, text, uuid, integer, integer) to anon, authenticated;
