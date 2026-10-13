create index if not exists rooms_public_matchmaking_bucket_idx
  on public.rooms (matchmaking_bucket, created_at)
  where room_visibility = 'public'
    and status = 'lobby';

create index if not exists room_players_device_status_seen_idx
  on public.room_players (device_player_id, status, last_seen_at desc);

create index if not exists room_players_room_status_role_joined_idx
  on public.room_players (room_id, status, role, joined_at);

create index if not exists round_scores_player_round_idx
  on public.round_scores (room_player_id, round_id);
