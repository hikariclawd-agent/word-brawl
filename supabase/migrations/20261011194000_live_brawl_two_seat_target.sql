-- Allow public Live Brawl to run as one human plus one real player or bot.

create or replace function public.advance_live_brawl_session(
  p_room_id uuid,
  p_player_id uuid,
  p_letter text,
  p_device_player_id text,
  p_capability uuid,
  p_round_seconds integer default 60,
  p_target_players integer default 4
)
returns table(room_status room_status, bot_count integer, round_id uuid, letter text, round_number integer, ends_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  r rooms%rowtype;
  rd rounds%rowtype;
  humans int;
  bots int;
  t timestamptz;
begin
  select * into r from rooms where id = p_room_id for update;
  perform require_room_capability(p_room_id, p_player_id, p_device_player_id, p_capability);
  t := clock_timestamp();

  if r.room_visibility <> 'public' then
    raise exception 'Not a public session';
  end if;

  if p_target_players is null or p_target_players < 2 or p_target_players > 8 or p_letter !~ '^[A-Z]$' then
    raise exception 'Invalid Live Brawl request';
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

  if r.started_at is null and t < r.created_at + interval '650 milliseconds' then
    return query select r.status, r.bot_count, null::uuid, null::text, null::int, null::timestamptz;
    return;
  end if;

  select count(*) into humans
  from room_players
  where room_id = r.id
    and role = 'player'
    and (status = 'active' or (status = 'disconnected' and left_at > t - interval '12 seconds'));

  bots := greatest(0, p_target_players - humans);

  insert into rounds(room_id, round_number, letter, starts_at, ends_at, started_by_player_id, status)
  select r.id, coalesce(max(rounds.round_number), 0) + 1, p_letter, t, t + make_interval(secs => r.round_seconds), p_player_id, 'active'
  from rounds
  where room_id = r.id
  returning * into rd;

  update rooms
  set bot_count = bots,
      started_at = coalesce(started_at, t),
      status = 'in_round'
  where id = r.id;

  return query select 'in_round'::room_status, bots, rd.id, rd.letter, rd.round_number, rd.ends_at;
end;
$$;

revoke all on function public.advance_live_brawl_session(uuid, uuid, text, text, uuid, integer, integer) from public;
grant execute on function public.advance_live_brawl_session(uuid, uuid, text, text, uuid, integer, integer) to anon, authenticated;
