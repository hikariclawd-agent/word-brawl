-- Protect dispute creation behind a membership and phase-checked RPC.
-- Vote/resolution hardening follows in a separate migration.

create or replace function public.open_answer_dispute_command(
  p_room_id uuid,
  p_round_id uuid,
  p_answer_id uuid,
  p_opened_by_player_id uuid,
  p_device_player_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  player_row public.room_players%rowtype;
  round_row public.rounds%rowtype;
  answer_row public.answers%rowtype;
  dispute_id uuid;
begin
  select * into player_row
  from public.room_players
  where id = p_opened_by_player_id
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
    and status in ('revealing', 'scored');

  if not found then
    raise exception 'Round is not accepting disputes.' using errcode = '55000';
  end if;

  select * into answer_row
  from public.answers
  where id = p_answer_id
    and round_id = p_round_id;

  if not found then
    raise exception 'Answer does not belong to this round.' using errcode = '22023';
  end if;

  select id into dispute_id
  from public.answer_disputes
  where answer_id = p_answer_id
    and status = 'open'
  limit 1;

  if found then
    return dispute_id;
  end if;

  insert into public.answer_disputes (
    answer_id,
    opened_by_player_id,
    round_id
  ) values (
    p_answer_id,
    p_opened_by_player_id,
    p_round_id
  )
  returning id into dispute_id;

  return dispute_id;
end;
$$;

revoke insert on public.answer_disputes from anon, authenticated;

grant execute on function public.open_answer_dispute_command(uuid, uuid, uuid, uuid, text)
  to anon, authenticated;
