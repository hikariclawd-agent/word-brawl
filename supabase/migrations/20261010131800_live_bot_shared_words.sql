create or replace function public.get_online_bot_round_snapshot(p_room_id uuid,p_round_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rooms%rowtype; rd rounds%rowtype; i int; profile int; category_value text;
 choices text[]; word_value text; verdict_value text; points_value int; seed bigint;
 answers_value jsonb; score_value int; count_value int; bots_value jsonb;
 names text[]:=array['Pixel','Moxie','Atlas','Ziggy','Nova','Echo','Clover'];
 profiles text[]:=array['Careful','Speedy','Aggressive','Chaotic','Scholar','Agreeable','Sloppy'];
begin
 select * into r from rooms where id=p_room_id for update;
 select * into rd from rounds where id=p_round_id and room_id=p_room_id;
 if rd.id is null then raise exception 'Round not found'; end if;
 if rd.status not in ('revealing','scored') and (rd.ends_at is null or rd.ends_at>clock_timestamp()) then raise exception 'Bot answers are hidden until reveal'; end if;
 for i in 1..r.bot_count loop
 if exists(select 1 from bot_round_snapshots where round_id=rd.id and bot_id='bot-'||i) then continue; end if;
 profile:=1+((i-1+get_byte(decode(md5(r.id::text),'hex'),0))%7);
 answers_value:='[]'; score_value:=0; count_value:=0;
 foreach category_value in array r.categories loop
 seed:=('x'||substr(md5(rd.id::text||':'||i||':'||category_value),1,8))::bit(32)::bigint;
 select array_agg(word order by case when profile in (3,5) then -length(word) else length(word) end,word) into choices
 from bot_word_bank where category=category_value and upper(left(word,1))=rd.letter;
 if profile in (1,2,3,5) and array_length(choices,1)>1 then choices:=choices[1:greatest(1,ceil(array_length(choices,1)/2.0)::int)]; end if;
 word_value:=coalesce(choices[1+((seed/100+i+profile)%greatest(1,coalesce(array_length(choices,1),0)))::int],'');
 -- Distinct fill/error profiles, adjusted by the configured difficulty.
 if seed%100 < greatest(0,(array[8,14,18,25,4,10,32])[profile]+case r.bot_difficulty when 'Easy' then 14 when 'Hard' then -4 else 0 end) then word_value:=''; end if;
 verdict_value:=case when word_value='' then 'blank' else 'valid' end;
 if word_value<>'' and (seed/100)%100 < (array[1,18,4,25,0,3,12])[profile] then
 word_value:=left(word_value,greatest(1,length(word_value)-1))||'x'; verdict_value:='invalid'; end if;
 points_value:=case when verdict_value='valid' then coalesce((r.scoring_rules->>'unique')::int,10) else 0 end;
 answers_value:=answers_value||jsonb_build_array(jsonb_build_object('category',category_value,'answer',word_value,'verdict',verdict_value,'points',points_value));
 score_value:=score_value+points_value; count_value:=count_value+case when word_value<>'' then 1 else 0 end;
 end loop;
 insert into bot_round_snapshots values(r.id,rd.id,'bot-'||i,jsonb_build_object('playerId','bot-'||i,'playerName',names[profile],'personality',profiles[profile],'answers',answers_value,'answeredCount',count_value,'score',score_value));
 end loop;
 -- Apply the existing shared-word rule consistently across CPU answers and submitted humans.
 with revised as (
  select bs.round_id,bs.bot_id,jsonb_agg(
   case when entry->>'verdict'='valid' and (
    exists(select 1 from answers ha where ha.round_id=rd.id and ha.category=entry->>'category'
      and lower(regexp_replace(ha.answer_text,'[^a-zA-Z]','','g'))=lower(regexp_replace(entry->>'answer','[^a-zA-Z]','','g')))
    or exists(select 1 from bot_round_snapshots other cross join lateral jsonb_array_elements(other.snapshot->'answers') oa
      where other.round_id=rd.id and other.bot_id<>bs.bot_id and oa->>'category'=entry->>'category'
      and lower(regexp_replace(oa->>'answer','[^a-zA-Z]','','g'))=lower(regexp_replace(entry->>'answer','[^a-zA-Z]','','g')))
   ) then entry||jsonb_build_object('verdict','duplicate','points',coalesce((r.scoring_rules->>'shared')::int,5))
   else entry end order by ord) as entries
  from bot_round_snapshots bs cross join lateral jsonb_array_elements(bs.snapshot->'answers') with ordinality as e(entry,ord)
  where bs.round_id=rd.id group by bs.round_id,bs.bot_id
 ) update bot_round_snapshots bs set snapshot=bs.snapshot||jsonb_build_object('answers',revised.entries,'score',
   (select coalesce(sum((entry->>'points')::int),0) from jsonb_array_elements(revised.entries) entry))
 from revised where bs.round_id=revised.round_id and bs.bot_id=revised.bot_id;
 select coalesce(jsonb_agg(s.snapshot||jsonb_build_object('totalScore',(
 select coalesce(sum((prior.snapshot->>'score')::int),0) from bot_round_snapshots prior join rounds pr on pr.id=prior.round_id
 where prior.room_id=r.id and prior.bot_id=s.bot_id and pr.round_number<=rd.round_number)) order by s.bot_id),'[]') into bots_value
 from bot_round_snapshots s where s.round_id=rd.id;
 return jsonb_build_object('roomId',r.id,'roundId',rd.id,'bots',bots_value);
end $$;

