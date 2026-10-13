create or replace function public.create_managed_room(p_device_player_id text,p_display_name text,p_settings jsonb,p_options jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rooms%rowtype; pid uuid; cap uuid;
begin
 insert into rooms(code,expires_at,room_visibility,max_players,matchmaking_bucket,ruleset_version,min_client_version)
 values(translate(upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),'01','XY'),
 clock_timestamp()+make_interval(mins=>least(60,greatest(1,coalesce((p_options->>'expiresInMinutes')::int,15)))),
 coalesce(p_options->>'visibility','private'),coalesce((p_options->>'maxPlayers')::int,8),
 coalesce(p_options->>'matchmakingBucket','rookie:level-1-5:global:ruleset-1'),coalesce((p_options->>'rulesetVersion')::int,1),coalesce(p_options->>'minClientVersion','1.0.0')) returning * into r;
 insert into room_players(room_id,device_player_id,display_name,is_host) values(r.id,p_device_player_id,trim(p_display_name),true) returning id into pid;
 insert into room_player_capabilities(player_id,room_id,device_player_id,can_manage) values(pid,r.id,p_device_player_id,true) returning capability into cap;
 perform update_online_room_settings(r.id,pid,p_device_player_id,cap,p_settings);
 update rooms set letter_picker_player_id=pid where id=r.id;
 return jsonb_build_object('roomId',r.id,'playerId',pid,'capability',cap);
end $$;
