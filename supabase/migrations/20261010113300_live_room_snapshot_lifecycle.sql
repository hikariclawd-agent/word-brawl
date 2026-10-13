-- Materialize bot rounds on reveal even if no client fetches that round.
create function public.materialize_bot_round_on_reveal() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status in ('revealing','scored') and old.status is distinct from new.status then
 perform get_online_bot_round_snapshot(new.room_id,new.id);
 end if;
 return new;
end $$;
create trigger materialize_bot_round_on_reveal after update of status on rounds for each row execute function materialize_bot_round_on_reveal();
-- Clients may change presence but may not resurrect a departed public seat after bots filled it.
create function public.guard_public_seat_reactivation() returns trigger language plpgsql security definer set search_path=public as $$
declare r rooms%rowtype;
begin
 if new.status='active' and old.status<>'active' then
 select * into r from rooms where id=new.room_id for update;
 if r.room_visibility='public' and not (old.status='disconnected' and old.left_at>clock_timestamp()-interval '12 seconds') then
 raise exception 'Reconnect window expired'; end if;
 end if;
 return new;
end $$;
create trigger guard_public_seat_reactivation before update of status on room_players for each row execute function guard_public_seat_reactivation();
