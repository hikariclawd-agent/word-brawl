-- Materialize the v2 scoring projection at the server-owned reveal boundary.
-- The legacy bot snapshot remains the first lifecycle action for v1 compatibility.
create or replace function public.materialize_bot_round_on_reveal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('revealing', 'scored') and old.status is distinct from new.status then
    perform public.get_online_bot_round_snapshot(new.room_id, new.id);

    if new.status = 'revealing'
       and exists (
         select 1
         from public.rooms r
         where r.id = new.room_id
           and r.room_visibility = 'public'
           and r.max_players = 5
           and r.ruleset_version >= 2
           and cardinality(r.categories) = 4
           and (
             select count(*)
             from public.room_players p
             where p.room_id = r.id
               and p.role = 'player'
               and p.status in ('active', 'disconnected')
           ) + r.bot_count = 5
       ) then
      -- This helper is deliberately not granted to clients; the trigger owns
      -- the reveal transition and runs it under its security-definer context.
      perform public.materialize_live_brawl_scoring(new.room_id, new.id);
    end if;
  end if;
  return new;
end;
$$;
