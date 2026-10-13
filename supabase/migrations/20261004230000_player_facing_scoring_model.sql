-- Replace technical verdict score keys with the three player-facing outcomes.
-- Technical verdicts remain in the data for moderation and migration safety.

update public.rooms
set scoring_rules = jsonb_build_object(
  'unique', coalesce((scoring_rules ->> 'unique')::integer, (scoring_rules ->> 'valid')::integer, 10),
  'shared', coalesce((scoring_rules ->> 'shared')::integer, (scoring_rules ->> 'duplicate')::integer, 5),
  'no_score', coalesce((scoring_rules ->> 'no_score')::integer, 0)
);

create or replace function public.apply_server_answer_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rules jsonb;
  room_id_value uuid;
  outcome_key text;
  configured_points integer;
begin
  select r.room_id into room_id_value
  from public.rounds r
  where r.id = new.round_id;

  select scoring_rules into rules
  from public.rooms
  where id = room_id_value;

  outcome_key := case
    when new.verdict = 'valid' then 'unique'
    when new.verdict = 'duplicate' then 'shared'
    else 'no_score'
  end;

  configured_points := nullif(rules ->> outcome_key, '')::integer;
  new.points := greatest(0, least(100, coalesce(configured_points, 0)));
  return new;
end;
$$;

comment on column public.rooms.scoring_rules is
  'Server-owned player-facing scoring map: unique, shared, no_score.';
