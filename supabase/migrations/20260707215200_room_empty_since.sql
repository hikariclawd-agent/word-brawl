alter table public.rooms
add column empty_since timestamptz;

create index rooms_empty_since_idx on public.rooms(empty_since)
where empty_since is not null;
