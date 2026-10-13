alter table public.rooms
  add column if not exists matchmaking_bucket text not null default 'rookie:level-1-5:global:ruleset-1',
  add column if not exists ruleset_version integer not null default 1,
  add column if not exists min_client_version text not null default '1.0.0';

alter table public.rooms
  drop constraint if exists rooms_matchmaking_bucket_check,
  drop constraint if exists rooms_ruleset_version_check,
  drop constraint if exists rooms_min_client_version_check;

alter table public.rooms
  add constraint rooms_matchmaking_bucket_check check (
    matchmaking_bucket ~ '^[a-z0-9:-]{6,120}$'
  ),
  add constraint rooms_ruleset_version_check check (
    ruleset_version between 1 and 100
  ),
  add constraint rooms_min_client_version_check check (
    min_client_version ~ '^[0-9]+[.][0-9]+[.][0-9]+$'
  );

drop index if exists rooms_public_lobby_lookup_idx;

create index rooms_public_lobby_bucket_lookup_idx
  on public.rooms (matchmaking_bucket, ruleset_version, created_at)
  where room_visibility = 'public'
    and status = 'lobby';
