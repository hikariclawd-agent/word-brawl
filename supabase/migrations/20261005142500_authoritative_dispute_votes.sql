-- Protect dispute vote writes behind room membership and dispute validation.
-- Resolution remains a follow-up command so the legacy beta resolver can be
-- removed without changing this vote contract.

create or replace function public.cast_answer_dispute_vote_command(
  p_room_id uuid,
  p_round_id uuid,
  p_dispute_id uuid,
  p_voter_player_id uuid,
  p_device_player_id text,
  p_verdict text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  player_row public.room_players%rowtype;
  dispute_row public.answer_disputes%rowtype;
  vote_value public.vote_verdict;
begin
  begin
    vote_value := p_verdict::public.vote_verdict;
  exception when invalid_text_representation then
    raise exception 'Invalid dispute verdict.' using errcode = '22023';
  end;

  select * into player_row
  from public.room_players
  where id = p_voter_player_id
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
    and d.status = 'open';

  if not found then
    raise exception 'Dispute is not open in this room.' using errcode = '55000';
  end if;

  insert into public.answer_dispute_votes (
    dispute_id,
    voter_player_id,
    verdict
  ) values (
    p_dispute_id,
    p_voter_player_id,
    vote_value
  )
  on conflict (dispute_id, voter_player_id)
  do update set verdict = excluded.verdict;

  return jsonb_build_object(
    'accepted', true,
    'dispute_id', p_dispute_id,
    'verdict', vote_value::text
  );
end;
$$;

revoke insert, update on public.answer_dispute_votes from anon, authenticated;

grant execute on function public.cast_answer_dispute_vote_command(uuid, uuid, uuid, uuid, text, text)
  to anon, authenticated;
