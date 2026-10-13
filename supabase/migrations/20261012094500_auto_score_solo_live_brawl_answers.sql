-- A Live Brawl room can contain one human plus committed bot seats. Bots do not
-- own vote rows, so a human answer with no eligible human voter must be scored
-- by the server immediately instead of finishing the round with blank verdicts.

create or replace function public.auto_score_solo_live_brawl_answer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  round_row public.rounds%rowtype;
  eligible_voter_count integer;
  resolved_verdict public.answer_verdict;
begin
  if coalesce(new.answer_text, '') = '' then
    return new;
  end if;

  if new.verdict <> 'blank'::public.answer_verdict or new.points <> 0 then
    return new;
  end if;

  select *
  into round_row
  from public.rounds
  where id = new.round_id;

  if not found then
    return new;
  end if;

  select count(*)::integer
  into eligible_voter_count
  from public.room_players rp
  where rp.room_id = round_row.room_id
    and rp.role = 'player'
    and rp.status = 'active'
    and rp.id <> new.room_player_id;

  if eligible_voter_count = 0 then
    resolved_verdict := public.live_brawl_auto_vote(new.answer_text, new.category, round_row.letter)::text::public.answer_verdict;
    new.verdict := resolved_verdict;
    new.points := case resolved_verdict
      when 'valid' then 10
      when 'duplicate' then 5
      when 'variant' then 5
      else 0
    end;
    new.updated_at := clock_timestamp();
  end if;

  return new;
end;
$$;

drop trigger if exists auto_score_solo_live_brawl_answer_before_write on public.answers;
create trigger auto_score_solo_live_brawl_answer_before_write
before insert or update of answer_text on public.answers
for each row
execute function public.auto_score_solo_live_brawl_answer();

with solo_answers as (
  select
    a.id,
    public.live_brawl_auto_vote(a.answer_text, a.category, rd.letter)::text::public.answer_verdict as resolved_verdict
  from public.answers a
  join public.rounds rd on rd.id = a.round_id
  where a.answer_text <> ''
    and a.verdict = 'blank'::public.answer_verdict
    and not exists (
      select 1
      from public.room_players rp
      where rp.room_id = rd.room_id
        and rp.role = 'player'
        and rp.status = 'active'
        and rp.id <> a.room_player_id
    )
)
update public.answers a
set verdict = solo_answers.resolved_verdict,
    points = case solo_answers.resolved_verdict
      when 'valid' then 10
      when 'duplicate' then 5
      when 'variant' then 5
      else 0
    end,
    updated_at = clock_timestamp()
from solo_answers
where a.id = solo_answers.id;

do $$
declare
  score_row record;
begin
  for score_row in
    select distinct a.round_id, a.room_player_id
    from public.answers a
    join public.rounds rd on rd.id = a.round_id
    where a.answer_text <> ''
      and not exists (
        select 1
        from public.room_players rp
        where rp.room_id = rd.room_id
          and rp.role = 'player'
          and rp.status = 'active'
          and rp.id <> a.room_player_id
      )
  loop
    perform public.refresh_live_brawl_round_score(score_row.round_id, score_row.room_player_id);
  end loop;
end $$;

grant execute on function public.auto_score_solo_live_brawl_answer() to anon, authenticated;
