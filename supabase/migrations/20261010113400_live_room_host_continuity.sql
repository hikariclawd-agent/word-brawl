-- Host succession is server selected, never a client-set is_host flag.
create function public.maintain_room_host() returns trigger language plpgsql security definer set search_path=public as $$
declare successor uuid;
begin
 if old.is_host and new.status in ('left','kicked','timed_out','banned') and old.status is distinct from new.status then
 perform 1 from rooms where id=new.room_id for update;
 select p.id into successor from room_players p join room_player_capabilities c on c.player_id=p.id
 where p.room_id=new.room_id and p.id<>new.id and p.role='player' and p.status='active' order by p.joined_at limit 1;
 if successor is not null then
 update room_players set is_host=(id=successor) where room_id=new.room_id;
 update room_player_capabilities set can_manage=(player_id=successor) where room_id=new.room_id;
 end if;
 end if;
 return new;
end $$;
create trigger maintain_room_host after update of status on room_players for each row execute function maintain_room_host();
