-- Keep server scoring configurable so the scoring format can change without
-- rewriting command handlers or trusting the client.

alter table public.rooms
  add column if not exists scoring_rules jsonb not null default '{"valid":10,"duplicate":5,"variant":5,"invalid":0,"blank":0}'::jsonb;

create or replace function public.apply_server_answer_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  rules jsonb;
  room_id_value uuid;
  configured_points integer;
begin
  select r.room_id into room_id_value
  from public.rounds r
  where r.id = new.round_id;

  select scoring_rules into rules
  from public.rooms
  where id = room_id_value;

  configured_points := nullif(rules ->> new.verdict::text, '')::integer;
  new.points := greatest(0, least(100, coalesce(configured_points, 0)));
  return new;
end;
$$;

drop trigger if exists apply_server_answer_points on public.answers;

create trigger apply_server_answer_points
before insert or update of verdict, points on public.answers
for each row execute function public.apply_server_answer_points();

comment on column public.rooms.scoring_rules is
  'Versioned server-owned scoring map. Clients cannot choose answer points.';
