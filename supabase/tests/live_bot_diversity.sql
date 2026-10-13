begin;
do $$
declare s jsonb := '{"bot_count":7,"bot_difficulty":"Normal","categories":["Name","Place","Animal","Food","Object","Job","Brand"],"mode_label":"Diversity QA","mode_rules":"Test","round_seconds":60,"scoring_owner":"Opponents","scoring_style":"Classic","target_rounds":30}';
 created jsonb; roomid uuid; roundid uuid; snap jsonb; roster jsonb; n int; names int;
begin
 created:=create_managed_room('diversity-test-device','Diversity QA',s);roomid:=(created->>'roomId')::uuid;
 roster:=get_online_bot_roster(roomid);
 assert jsonb_array_length(roster)=7;
 select count(distinct entry->>'personality') into names from jsonb_array_elements(roster) entry;
 assert names=7,'Roster personalities duplicated';
 for n in 1..20 loop
  insert into rounds(room_id,round_number,letter,status,starts_at,ends_at) values(roomid,n,'A','revealing',now()-interval '60 seconds',now()) returning id into roundid;
  snap:=get_online_bot_round_snapshot(roomid,roundid);
  assert snap=get_online_bot_round_snapshot(roomid,roundid),'Replay changed bot decisions';
  assert (select bool_and(a->>'playerName'=b->>'playerName' and a->>'personality'=b->>'personality') from jsonb_array_elements(roster) a join jsonb_array_elements(snap->'bots') b on a->>'playerId'=b->>'playerId'),'Pre-reveal identities differ';
 end loop;
 assert (select count(distinct blanks)>1 from (
  select bs.bot_id,count(*) filter(where ans->>'answer'='') blanks
  from bot_round_snapshots bs cross join lateral jsonb_array_elements(bs.snapshot->'answers') ans
  where bs.room_id=roomid group by bs.bot_id) counts),'Profiles show identical fill behaviour';
 assert (select count(*)>0 from bot_round_snapshots bs cross join lateral jsonb_array_elements(bs.snapshot->'answers') ans where bs.room_id=roomid and ans->>'verdict'='duplicate'),'Shared-word scoring absent';
 raise notice 'PASS: seven distinct identities, 20 stable rounds, different fill behaviours, shared-word scoring';
end $$;
rollback;
