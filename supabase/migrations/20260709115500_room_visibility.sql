create type public.room_visibility as enum ('private', 'public');

alter table public.rooms
  add column room_visibility public.room_visibility not null default 'private';

create index rooms_public_lobby_lookup_idx
  on public.rooms (created_at)
  where room_visibility = 'public'
    and status = 'lobby';
