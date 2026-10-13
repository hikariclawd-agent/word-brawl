alter table public.rooms
add column letter_picker_player_id uuid references public.room_players(id) on delete set null;

create index rooms_letter_picker_player_id_idx on public.rooms(letter_picker_player_id);
