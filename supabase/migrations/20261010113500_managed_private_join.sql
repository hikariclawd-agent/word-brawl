create function public.join_managed_room(p_code text,p_device_player_id text,p_display_name text,p_capabilities jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rooms%rowtype; p room_players%rowtype; cap uuid;
begin
 select * into r from rooms where code=p_code and status not in ('finished','expired') and expires_at>clock_timestamp() for update;
 if r.id is null then raise exception 'Room not found or expired.'; end if;
 select * into p from room_players where room_id=r.id and device_player_id=p_device_player_id;
 if found then
 select capability into cap from room_player_capabilities where player_id=p.id and capability::text=p_capabilities->>p.id::text;
 if cap is null then raise exception 'Room permission denied.' using errcode='42501'; end if;
 if not (p.status='active' or (p.status='disconnected' and p.left_at>clock_timestamp()-interval '12 seconds')) then raise exception 'Reconnect window expired'; end if;
 update room_players set status='active',left_at=null,last_seen_at=clock_timestamp(),display_name=trim(p_display_name) where id=p.id;
 else
 if r.status<>'lobby' or r.started_at is not null then raise exception 'Room already started'; end if;
 if (select count(*) from room_players where room_id=r.id and role='player' and (status='active' or (status='disconnected' and left_at>clock_timestamp()-interval '12 seconds')))+r.bot_count>=r.max_players then raise exception 'Room is full'; end if;
 insert into room_players(room_id,device_player_id,display_name) values(r.id,p_device_player_id,trim(p_display_name)) returning * into p;
 insert into room_player_capabilities(player_id,room_id,device_player_id) values(p.id,r.id,p_device_player_id) returning capability into cap;
 end if;
 update rooms set empty_since=null where id=r.id;
 return jsonb_build_object('roomId',r.id,'playerId',p.id,'capability',cap);
end $$;
revoke all on function public.join_managed_room(text,text,text,jsonb) from public;
grant execute on function public.join_managed_room(text,text,text,jsonb) to anon,authenticated;
