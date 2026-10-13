alter table public.rooms
drop constraint if exists rooms_bot_count_check;

alter table public.rooms
add constraint rooms_bot_count_check check (bot_count between 0 and 7);
