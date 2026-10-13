-- Private capabilities cannot be read or minted by a client for existing players.
create table public.room_player_capabilities (
 player_id uuid primary key references public.room_players(id) on delete cascade,
 room_id uuid not null references public.rooms(id) on delete cascade,
 device_player_id text not null,
 capability uuid not null default gen_random_uuid(),
 can_manage boolean not null default false
);
alter table public.room_player_capabilities enable row level security;
revoke all on public.room_player_capabilities from public, anon, authenticated;
create function public.require_room_capability(p_room_id uuid,p_player_id uuid,p_device_player_id text,p_capability uuid,p_manage boolean default false)
returns void language plpgsql security definer set search_path=public as $$
begin
 if not exists(select 1 from room_player_capabilities c join room_players p on p.id=c.player_id
 where c.room_id=p_room_id and p.room_id=p_room_id and c.player_id=p_player_id
 and c.device_player_id=p_device_player_id and p.device_player_id=p_device_player_id
 and c.capability=p_capability and p.role='player' and p.status='active'
 and (not p_manage or (c.can_manage and p.is_host))) then
 raise exception 'Room permission denied.' using errcode='42501'; end if;
end $$;
revoke all on function public.require_room_capability(uuid,uuid,text,uuid,boolean) from public;
create function public.update_online_room_settings(p_room_id uuid,p_player_id uuid,p_device_player_id text,p_capability uuid,p_settings jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare r rooms%rowtype;
begin
 select * into r from rooms where id=p_room_id for update;
 perform require_room_capability(p_room_id,p_player_id,p_device_player_id,p_capability,true);
 if r.status<>'lobby' or r.started_at is not null or r.expires_at<=clock_timestamp() then raise exception 'Room setup is locked.'; end if;
 if not (p_settings->'categories' <@ ' ["Name","Place","Animal","Food","Object","Job","Brand"]'::jsonb) or jsonb_array_length(p_settings->'categories') not between 1 and 7 then raise exception 'Invalid categories'; end if;
 update rooms set bot_count=(p_settings->>'bot_count')::int, bot_difficulty=p_settings->>'bot_difficulty',
 categories=array(select jsonb_array_elements_text(p_settings->'categories')),
 match_duration_seconds=(p_settings->>'match_duration_seconds')::int,
 mode_label=left(p_settings->>'mode_label',80),mode_rules=left(p_settings->>'mode_rules',500),
 round_seconds=(p_settings->>'round_seconds')::int,scoring_owner=p_settings->>'scoring_owner',
 scoring_style=p_settings->>'scoring_style',target_rounds=(p_settings->>'target_rounds')::int where id=p_room_id;
end $$;
-- Legacy lifecycle writes remain; settings and identity writes do not.
revoke update on public.rooms from anon,authenticated;
grant update(status,ended_at,empty_since,letter_picker_player_id,started_at) on public.rooms to anon,authenticated;
revoke update on public.room_players from anon,authenticated;
grant update(display_name,last_seen_at,left_at,status) on public.room_players to anon,authenticated;
create function public.create_managed_room(p_device_player_id text,p_display_name text,p_settings jsonb,p_options jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rooms%rowtype; pid uuid; cap uuid;
begin
 insert into rooms(code,expires_at,room_visibility,max_players,matchmaking_bucket,ruleset_version,min_client_version)
 values(translate(upper(substr(encode(gen_random_bytes(6),'hex'),1,6)),'01','XY'),
 clock_timestamp()+make_interval(mins=>least(60,greatest(1,coalesce((p_options->>'expiresInMinutes')::int,15)))),
 coalesce(p_options->>'visibility','private'),coalesce((p_options->>'maxPlayers')::int,8),
 coalesce(p_options->>'matchmakingBucket','rookie:level-1-5:global:ruleset-1'),coalesce((p_options->>'rulesetVersion')::int,1),coalesce(p_options->>'minClientVersion','1.0.0')) returning * into r;
 insert into room_players(room_id,device_player_id,display_name,is_host) values(r.id,p_device_player_id,trim(p_display_name),true) returning id into pid;
 insert into room_player_capabilities(player_id,room_id,device_player_id,can_manage) values(pid,r.id,p_device_player_id,true) returning capability into cap;
 perform update_online_room_settings(r.id,pid,p_device_player_id,cap,p_settings);
 update rooms set letter_picker_player_id=pid where id=r.id;
 return jsonb_build_object('roomId',r.id,'playerId',pid,'capability',cap);
end $$;
create function public.find_or_create_public_room(p_device_player_id text,p_display_name text,p_settings jsonb,p_options jsonb,p_capabilities jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rooms%rowtype; p room_players%rowtype; cap uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_options->>'matchmakingBucket',0));
 for r in select * from rooms where room_visibility='public' and expires_at>clock_timestamp()
 and status not in ('finished','expired') and matchmaking_bucket=p_options->>'matchmakingBucket'
 and ruleset_version=(p_options->>'rulesetVersion')::int order by created_at for update loop
 select * into p from room_players where room_id=r.id and device_player_id=p_device_player_id;
 if found then
   select capability into cap from room_player_capabilities where player_id=p.id and capability::text=p_capabilities->>p.id::text;
   if cap is not null and (p.status='active' or (p.status='disconnected' and p.left_at>clock_timestamp()-interval '12 seconds')) then
    update room_players set status='active',left_at=null,last_seen_at=clock_timestamp(),display_name=trim(p_display_name) where id=p.id;
    return jsonb_build_object('roomId',r.id,'playerId',p.id,'capability',cap);
   end if;
   continue;
 end if;
 if r.status='lobby' and r.started_at is null and r.created_at+interval '300 milliseconds'>clock_timestamp()
 and (select count(*) from room_players where room_id=r.id and role='player' and (status='active' or (status='disconnected' and left_at>clock_timestamp()-interval '12 seconds')))+r.bot_count<4 then
  insert into room_players(room_id,device_player_id,display_name) values(r.id,p_device_player_id,trim(p_display_name)) returning * into p;
  insert into room_player_capabilities(player_id,room_id,device_player_id) values(p.id,r.id,p_device_player_id) returning capability into cap;
  return jsonb_build_object('roomId',r.id,'playerId',p.id,'capability',cap);
 end if;
 end loop;
 return create_managed_room(p_device_player_id,p_display_name,p_settings||'{"bot_count":0}',p_options||'{"visibility":"public","maxPlayers":4,"expiresInMinutes":10}');
end $$;
drop function public.advance_live_brawl_session(uuid,uuid,text,integer,integer);
create function public.advance_live_brawl_session(p_room_id uuid,p_player_id uuid,p_letter text,p_device_player_id text,p_capability uuid,p_round_seconds integer default 60,p_target_players integer default 4)
returns table(room_status room_status,bot_count integer,round_id uuid,letter text,round_number integer,ends_at timestamptz)
language plpgsql security definer set search_path=public as $$
declare r rooms%rowtype; rd rounds%rowtype; humans int; bots int; t timestamptz;
begin
 select * into r from rooms where id=p_room_id for update;
 perform require_room_capability(p_room_id,p_player_id,p_device_player_id,p_capability);
 t:=clock_timestamp();
 if r.room_visibility<>'public' then raise exception 'Not a public session'; end if;
 if p_target_players<>4 or p_letter!~'^[A-Z]$' then raise exception 'Invalid Live Brawl request'; end if;
 if r.expires_at<=t then raise exception 'Session expired'; end if;
 if r.status<>'lobby' then
 select * into rd from rounds where room_id=r.id and status in ('active','revealing') order by rounds.round_number desc limit 1;
 return query select r.status,r.bot_count,rd.id,rd.letter,rd.round_number,rd.ends_at; return;
 end if;
 if r.started_at is null and t<r.created_at+interval '300 milliseconds' then
 return query select r.status,r.bot_count,null::uuid,null::text,null::int,null::timestamptz; return;
 end if;
 select count(*) into humans from room_players where room_id=r.id and role='player' and (status='active' or (status='disconnected' and left_at>t-interval '12 seconds'));
 bots:=greatest(0,4-humans);
 insert into rounds(room_id,round_number,letter,starts_at,ends_at,started_by_player_id,status)
 select r.id,coalesce(max(rounds.round_number),0)+1,p_letter,t,t+make_interval(secs=>r.round_seconds),p_player_id,'active' from rounds where room_id=r.id returning * into rd;
 update rooms set bot_count=bots,started_at=coalesce(started_at,t),status='in_round' where id=r.id;
 return query select 'in_round'::room_status,bots,rd.id,rd.letter,rd.round_number,rd.ends_at;
end $$;

create table public.bot_word_bank(category text not null,word text not null,primary key(category,word));
alter table public.bot_word_bank enable row level security;
revoke all on public.bot_word_bank from public,anon,authenticated;
insert into public.bot_word_bank values
('Animal','Antelope'),
('Animal','Bear'),
('Animal','Cat'),
('Animal','Dog'),
('Animal','Eagle'),
('Animal','Falcon'),
('Animal','Goat'),
('Animal','Horse'),
('Animal','Iguana'),
('Animal','Jaguar'),
('Animal','Koala'),
('Animal','Lion'),
('Animal','Monkey'),
('Animal','Newt'),
('Animal','Otter'),
('Animal','Panda'),
('Animal','Quail'),
('Animal','Rabbit'),
('Animal','Snake'),
('Animal','Tiger'),
('Animal','Urial'),
('Animal','Viper'),
('Animal','Wolf'),
('Animal','Xerus'),
('Animal','Yak'),
('Animal','Zebra'),
('Animal','Aardvark'),
('Animal','Buffalo'),
('Animal','Cheetah'),
('Animal','Dolphin'),
('Animal','Elephant'),
('Animal','Fox'),
('Animal','Giraffe'),
('Animal','Hyena'),
('Animal','Impala'),
('Animal','Jackal'),
('Animal','Kangaroo'),
('Animal','Leopard'),
('Animal','Mongoose'),
('Animal','Narwhal'),
('Animal','Ostrich'),
('Animal','Penguin'),
('Animal','Quokka'),
('Animal','Rhino'),
('Animal','Shark'),
('Animal','Tortoise'),
('Animal','Uakari'),
('Animal','Vulture'),
('Animal','Whale'),
('Animal','Xenops'),
('Animal','Yellowhammer'),
('Animal','Zebu'),
('Animal','Alpaca'),
('Animal','Baboon'),
('Animal','Camel'),
('Animal','Deer'),
('Animal','Emu'),
('Animal','Ferret'),
('Animal','Gazelle'),
('Animal','Hedgehog'),
('Animal','Ibex'),
('Animal','Jellyfish'),
('Animal','Kingfisher'),
('Animal','Lemur'),
('Animal','Meerkat'),
('Animal','Numbat'),
('Animal','Octopus'),
('Animal','Peacock'),
('Animal','Quetzal'),
('Animal','Raccoon'),
('Animal','Seal'),
('Animal','Toucan'),
('Animal','Urchin'),
('Animal','Vicuna'),
('Animal','Walrus'),
('Animal','Xolo'),
('Animal','Yabby'),
('Animal','Zorilla'),
('Name','Alex'),
('Name','Bella'),
('Name','Caleb'),
('Name','Diana'),
('Name','Ethan'),
('Name','Fatima'),
('Name','Grace'),
('Name','Hassan'),
('Name','Isaac'),
('Name','Jade'),
('Name','Kofi'),
('Name','Lola'),
('Name','Maya'),
('Name','Nadia'),
('Name','Omar'),
('Name','Peter'),
('Name','Queenie'),
('Name','Rita'),
('Name','Samuel'),
('Name','Tunde'),
('Name','Uche'),
('Name','Victor'),
('Name','Wendy'),
('Name','Xavier'),
('Name','Yara'),
('Name','Zara'),
('Name','Amina'),
('Name','Brian'),
('Name','Chika'),
('Name','Daniel'),
('Name','Esther'),
('Name','Femi'),
('Name','Gloria'),
('Name','Hannah'),
('Name','Ibrahim'),
('Name','James'),
('Name','Kwame'),
('Name','Linda'),
('Name','Michael'),
('Name','Nana'),
('Name','Olivia'),
('Name','Priya'),
('Name','Quincy'),
('Name','Rachel'),
('Name','Sarah'),
('Name','Theo'),
('Name','Uma'),
('Name','Vanessa'),
('Name','William'),
('Name','Ximena'),
('Name','Yusuf'),
('Name','Zainab'),
('Name','Ada'),
('Name','Bola'),
('Name','Chioma'),
('Name','David'),
('Name','Ebere'),
('Name','Freya'),
('Name','George'),
('Name','Helen'),
('Name','Ife'),
('Name','Jonah'),
('Name','Keisha'),
('Name','Luke'),
('Name','Malik'),
('Name','Naomi'),
('Name','Oscar'),
('Name','Paula'),
('Name','Quinn'),
('Name','Ruth'),
('Name','Sade'),
('Name','Tariq'),
('Name','Uriel'),
('Name','Vera'),
('Name','Wale'),
('Name','Xena'),
('Name','Yemi'),
('Name','Zion'),
('Name','Joe'),
('Place','Accra'),
('Place','Berlin'),
('Place','Cairo'),
('Place','Durban'),
('Place','Enugu'),
('Place','Florence'),
('Place','Ghana'),
('Place','Harare'),
('Place','Ibadan'),
('Place','Jakarta'),
('Place','Kano'),
('Place','Lagos'),
('Place','Madrid'),
('Place','Nairobi'),
('Place','Oslo'),
('Place','Paris'),
('Place','Qatar'),
('Place','Rome'),
('Place','Seoul'),
('Place','Tokyo'),
('Place','Uyo'),
('Place','Vienna'),
('Place','Warsaw'),
('Place','Xian'),
('Place','Yaounde'),
('Place','Zurich'),
('Place','Abuja'),
('Place','Bradford'),
('Place','Cape Town'),
('Place','Dakar'),
('Place','Edinburgh'),
('Place','Freetown'),
('Place','Geneva'),
('Place','Houston'),
('Place','Istanbul'),
('Place','Johannesburg'),
('Place','Kigali'),
('Place','London'),
('Place','Manchester'),
('Place','Naples'),
('Place','Oxford'),
('Place','Pretoria'),
('Place','Quebec'),
('Place','Rotterdam'),
('Place','Sydney'),
('Place','Toronto'),
('Place','Uganda'),
('Place','Venice'),
('Place','Wembley'),
('Place','Xiamen'),
('Place','York'),
('Place','Zambia'),
('Place','Athens'),
('Place','Bristol'),
('Place','Chicago'),
('Place','Delhi'),
('Place','Edo'),
('Place','Frankfurt'),
('Place','Gaborone'),
('Place','Helsinki'),
('Place','Ilorin'),
('Place','Kaduna'),
('Place','Kyoto'),
('Place','Lisbon'),
('Place','Milan'),
('Place','New York'),
('Place','Orlando'),
('Place','Porto'),
('Place','Queens'),
('Place','Rwanda'),
('Place','Stockholm'),
('Place','Tripoli'),
('Place','Utrecht'),
('Place','Valencia'),
('Place','Winnipeg'),
('Place','Xalapa'),
('Place','Yokohama'),
('Place','Zimbabwe'),
('Brand','Apple'),
('Brand','Bose'),
('Brand','Canon'),
('Brand','Disney'),
('Brand','Ebay'),
('Brand','Fanta'),
('Brand','Google'),
('Brand','Honda'),
('Brand','Intel'),
('Brand','Jeep'),
('Brand','Kia'),
('Brand','Lego'),
('Brand','Meta'),
('Brand','Nike'),
('Brand','Oppo'),
('Brand','Pepsi'),
('Brand','Quaker'),
('Brand','Rolex'),
('Brand','Samsung'),
('Brand','Toyota'),
('Brand','Uber'),
('Brand','Visa'),
('Brand','Walmart'),
('Brand','Xbox'),
('Brand','Yamaha'),
('Brand','Zara'),
('Brand','Adidas'),
('Brand','Burger King'),
('Brand','Coca Cola'),
('Brand','Dell'),
('Brand','Emirates'),
('Brand','Ford'),
('Brand','Gucci'),
('Brand','HP'),
('Brand','Instagram'),
('Brand','Jordan'),
('Brand','KFC'),
('Brand','LinkedIn'),
('Brand','Mercedes'),
('Brand','Netflix'),
('Brand','Oracle'),
('Brand','PlayStation'),
('Brand','Qantas'),
('Brand','Red Bull'),
('Brand','Spotify'),
('Brand','Tesla'),
('Brand','Under Armour'),
('Brand','Vans'),
('Brand','WhatsApp'),
('Brand','Xiaomi'),
('Brand','YouTube'),
('Brand','Zoom'),
('Brand','Acer'),
('Brand','Balenciaga'),
('Brand','Cadbury'),
('Brand','Dominos'),
('Brand','Etsy'),
('Brand','Fila'),
('Brand','Glo'),
('Brand','Huawei'),
('Brand','Ikea'),
('Brand','Jumia'),
('Brand','Kodak'),
('Brand','Lacoste'),
('Brand','Microsoft'),
('Brand','Nvidia'),
('Brand','Olympus'),
('Brand','Prada'),
('Brand','Qualcomm'),
('Brand','Reebok'),
('Brand','Shell'),
('Brand','TikTok'),
('Brand','Unilever'),
('Brand','Virgin'),
('Brand','WordPress'),
('Brand','Xfinity'),
('Brand','Yelp'),
('Brand','Zalando'),
('Food','Apple'),
('Food','Bread'),
('Food','Cake'),
('Food','Donut'),
('Food','Egg'),
('Food','Fish'),
('Food','Gari'),
('Food','Honey'),
('Food','Icecream'),
('Food','Jollof'),
('Food','Kebab'),
('Food','Lemon'),
('Food','Mango'),
('Food','Noodles'),
('Food','Okra'),
('Food','Pizza'),
('Food','Quiche'),
('Food','Rice'),
('Food','Soup'),
('Food','Taco'),
('Food','Udon'),
('Food','Vanilla'),
('Food','Waffles'),
('Food','Xigua'),
('Food','Yam'),
('Food','Ziti'),
('Food','Avocado'),
('Food','Beans'),
('Food','Chicken'),
('Food','Dumpling'),
('Food','Egusi'),
('Food','Falafel'),
('Food','Granola'),
('Food','Hotdog'),
('Food','Indomie'),
('Food','Jambalaya'),
('Food','Kiwi'),
('Food','Lasagne'),
('Food','Moi Moi'),
('Food','Nachos'),
('Food','Oats'),
('Food','Pasta'),
('Food','Quesadilla'),
('Food','Ramen'),
('Food','Salad'),
('Food','Toast'),
('Food','Ugba'),
('Food','Vegetables'),
('Food','Watermelon'),
('Food','Xacuti'),
('Food','Yoghurt'),
('Food','Zucchini'),
('Food','Akara'),
('Food','Burger'),
('Food','Couscous'),
('Food','Dates'),
('Food','Eba'),
('Food','Fries'),
('Food','Grapes'),
('Food','Hummus'),
('Food','Idli'),
('Food','Jam'),
('Food','Kale'),
('Food','Lentils'),
('Food','Meatballs'),
('Food','Nutmeg'),
('Food','Orange'),
('Food','Plantain'),
('Food','Quinoa'),
('Food','Risotto'),
('Food','Stew'),
('Food','Tuna'),
('Food','Ukwa'),
('Food','Vindaloo'),
('Food','Wrap'),
('Food','Xnipec'),
('Food','Yassa'),
('Food','Zobo'),
('Job','Artist'),
('Job','Baker'),
('Job','Chef'),
('Job','Doctor'),
('Job','Engineer'),
('Job','Farmer'),
('Job','Guard'),
('Job','Host'),
('Job','Inspector'),
('Job','Judge'),
('Job','Keeper'),
('Job','Lawyer'),
('Job','Mechanic'),
('Job','Nurse'),
('Job','Officer'),
('Job','Pilot'),
('Job','Quartermaster'),
('Job','Ranger'),
('Job','Singer'),
('Job','Teacher'),
('Job','Umpire'),
('Job','Vendor'),
('Job','Writer'),
('Job','Xylophonist'),
('Job','Youtuber'),
('Job','Zookeeper'),
('Job','Accountant'),
('Job','Barber'),
('Job','Carpenter'),
('Job','Dentist'),
('Job','Electrician'),
('Job','Firefighter'),
('Job','Guide'),
('Job','Hairdresser'),
('Job','Illustrator'),
('Job','Journalist'),
('Job','Knight'),
('Job','Lecturer'),
('Job','Manager'),
('Job','Nutritionist'),
('Job','Optician'),
('Job','Producer'),
('Job','Quality Inspector'),
('Job','Receptionist'),
('Job','Scientist'),
('Job','Tailor'),
('Job','Usher'),
('Job','Vet'),
('Job','Waiter'),
('Job','Xray Technician'),
('Job','Yoga Instructor'),
('Job','Zoologist'),
('Job','Actor'),
('Job','Banker'),
('Job','Courier'),
('Job','Designer'),
('Job','Editor'),
('Job','Florist'),
('Job','Geologist'),
('Job','Historian'),
('Job','Importer'),
('Job','Janitor'),
('Job','Keyholder'),
('Job','Librarian'),
('Job','Musician'),
('Job','Novelist'),
('Job','Operator'),
('Job','Photographer'),
('Job','Quantity Surveyor'),
('Job','Researcher'),
('Job','Surgeon'),
('Job','Translator'),
('Job','Undertaker'),
('Job','Videographer'),
('Job','Welder'),
('Job','Xray Operator'),
('Job','Youth Worker'),
('Job','Zumba Instructor'),
('Object','Apple'),
('Object','Book'),
('Object','Chair'),
('Object','Drum'),
('Object','Envelope'),
('Object','Fork'),
('Object','Guitar'),
('Object','Hammer'),
('Object','Ink'),
('Object','Jacket'),
('Object','Kettle'),
('Object','Lamp'),
('Object','Mirror'),
('Object','Notebook'),
('Object','Orange'),
('Object','Phone'),
('Object','Quilt'),
('Object','Radio'),
('Object','Spoon'),
('Object','Table'),
('Object','Umbrella'),
('Object','Violin'),
('Object','Wallet'),
('Object','Xbox'),
('Object','Yarn'),
('Object','Zip'),
('Object','Anchor'),
('Object','Bottle'),
('Object','Camera'),
('Object','Door'),
('Object','Eraser'),
('Object','Flag'),
('Object','Glasses'),
('Object','Helmet'),
('Object','Iron'),
('Object','Jar'),
('Object','Key'),
('Object','Laptop'),
('Object','Microphone'),
('Object','Needle'),
('Object','Oven'),
('Object','Pencil'),
('Object','Queue Ticket'),
('Object','Remote'),
('Object','Suitcase'),
('Object','Torch'),
('Object','Uniform'),
('Object','Vase'),
('Object','Watch'),
('Object','Xylophone'),
('Object','Yo-yo'),
('Object','Zipper'),
('Object','Arrow'),
('Object','Basket'),
('Object','Candle'),
('Object','Desk'),
('Object','Earphones'),
('Object','Fan'),
('Object','Globe'),
('Object','Hat'),
('Object','Icebox'),
('Object','Jug'),
('Object','Knife'),
('Object','Ladder'),
('Object','Mug'),
('Object','Net'),
('Object','Oil Lamp'),
('Object','Plate'),
('Object','Quartz'),
('Object','Ring'),
('Object','Scissors'),
('Object','Towel'),
('Object','USB'),
('Object','Vacuum'),
('Object','Whistle'),
('Object','Xerox'),
('Object','Yoyo'),
('Object','Ziplock');

create table public.bot_round_snapshots (
 room_id uuid not null references rooms(id) on delete cascade,
 round_id uuid not null references rounds(id) on delete cascade,
 bot_id text not null, snapshot jsonb not null,
 primary key(round_id,bot_id)
);
alter table public.bot_round_snapshots enable row level security;
revoke all on public.bot_round_snapshots from public,anon,authenticated;
create function public.get_online_bot_round_snapshot(p_room_id uuid,p_round_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r rooms%rowtype; rd rounds%rowtype; i int; profile int; category_value text;
 choices text[]; word_value text; verdict_value text; points_value int; seed bigint;
 answers_value jsonb; score_value int; count_value int; bots_value jsonb;
 names text[]:=array['Pixel','Moxie','Atlas','Ziggy','Nova','Echo','Clover'];
 profiles text[]:=array['careful','speedy','explorer','chaotic','scholar','steady','dreamer'];
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
 select array_agg(word order by case when profile in (1,5) then -length(word) else length(word) end,word) into choices
 from bot_word_bank where category=category_value and upper(left(word,1))=rd.letter;
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
 select coalesce(jsonb_agg(s.snapshot||jsonb_build_object('totalScore',(
 select coalesce(sum((prior.snapshot->>'score')::int),0) from bot_round_snapshots prior join rounds pr on pr.id=prior.round_id
 where prior.room_id=r.id and prior.bot_id=s.bot_id and pr.round_number<=rd.round_number)) order by s.bot_id),'[]') into bots_value
 from bot_round_snapshots s where s.round_id=rd.id;
 return jsonb_build_object('roomId',r.id,'roundId',rd.id,'bots',bots_value);
end $$;
-- These APIs are intentionally callable by guest clients; private helpers are not.
revoke all on function public.update_online_room_settings(uuid,uuid,text,uuid,jsonb),public.create_managed_room(text,text,jsonb,jsonb),public.find_or_create_public_room(text,text,jsonb,jsonb,jsonb),public.advance_live_brawl_session(uuid,uuid,text,text,uuid,integer,integer),public.get_online_bot_round_snapshot(uuid,uuid) from public;
grant execute on function public.update_online_room_settings(uuid,uuid,text,uuid,jsonb),public.create_managed_room(text,text,jsonb,jsonb),public.find_or_create_public_room(text,text,jsonb,jsonb,jsonb),public.advance_live_brawl_session(uuid,uuid,text,text,uuid,integer,integer),public.get_online_bot_round_snapshot(uuid,uuid) to anon,authenticated;
