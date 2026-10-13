create extension if not exists pgcrypto;

create type public.room_status as enum ('lobby', 'in_round', 'revealing', 'finished', 'expired');
create type public.player_role as enum ('player', 'spectator');
create type public.player_status as enum ('active', 'disconnected', 'left', 'kicked', 'timed_out', 'banned');
create type public.round_status as enum ('pending', 'active', 'revealing', 'scored', 'cancelled');
create type public.answer_verdict as enum ('blank', 'valid', 'duplicate', 'variant', 'invalid', 'disputed');
create type public.vote_verdict as enum ('valid', 'duplicate', 'variant', 'invalid');
create type public.report_status as enum ('open', 'reviewed', 'dismissed', 'actioned');
create type public.abuse_action as enum ('warning', 'timeout', 'room_ban', 'account_ban');

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  status public.room_status not null default 'lobby',
  max_players integer not null default 8,
  max_spectators integer not null default 20,
  round_seconds integer not null default 90,
  expires_at timestamptz not null default (now() + interval '1 hour'),
  started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (code ~ '^[A-Z2-9]{6}$'),
  check (max_players between 2 and 8),
  check (max_spectators between 0 and 20),
  check (round_seconds between 30 and 300)
);

create table public.room_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  device_player_id text not null,
  display_name text not null,
  role public.player_role not null default 'player',
  status public.player_status not null default 'active',
  is_host boolean not null default false,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  left_at timestamptz,
  check (char_length(device_player_id) between 8 and 128),
  check (char_length(display_name) between 1 and 40),
  unique (room_id, device_player_id)
);

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null,
  letter text not null,
  status public.round_status not null default 'pending',
  started_by_player_id uuid references public.room_players(id) on delete set null,
  starts_at timestamptz,
  ends_at timestamptz,
  revealed_at timestamptz,
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (round_number > 0),
  check (letter ~ '^[A-Z]$'),
  unique (room_id, round_number)
);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  room_player_id uuid not null references public.room_players(id) on delete cascade,
  category text not null,
  answer_text text not null default '',
  verdict public.answer_verdict not null default 'blank',
  points integer not null default 0,
  submitted_at timestamptz not null default now(),
  locked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(category) between 1 and 40),
  check (char_length(answer_text) <= 120),
  check (points between 0 and 10),
  unique (round_id, room_player_id, category)
);

create table public.votes (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.answers(id) on delete cascade,
  voter_player_id uuid not null references public.room_players(id) on delete cascade,
  verdict public.vote_verdict not null,
  created_at timestamptz not null default now(),
  unique (answer_id, voter_player_id)
);

create table public.round_scores (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  room_player_id uuid not null references public.room_players(id) on delete cascade,
  answered_count integer not null default 0,
  score integer not null default 0,
  invalid_streak integer not null default 0,
  penalty_points integer not null default 0,
  created_at timestamptz not null default now(),
  check (answered_count >= 0),
  unique (round_id, room_player_id)
);

create table public.category_packs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  is_default boolean not null default false,
  is_paid boolean not null default false,
  is_shareable boolean not null default false,
  owner_device_player_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(name) between 1 and 80),
  check (slug ~ '^[a-z0-9-]{2,80}$')
);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  pack_id uuid not null references public.category_packs(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (pack_id, name),
  check (char_length(name) between 1 and 40)
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  answer_id uuid references public.answers(id) on delete set null,
  reporter_player_id uuid references public.room_players(id) on delete set null,
  reported_player_id uuid references public.room_players(id) on delete set null,
  reason text not null,
  details text,
  status public.report_status not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (char_length(reason) between 1 and 80),
  check (details is null or char_length(details) <= 500)
);

create table public.abuse_strikes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid references public.rooms(id) on delete cascade,
  room_player_id uuid references public.room_players(id) on delete cascade,
  device_player_id text not null,
  action public.abuse_action not null,
  reason text not null,
  window_starts_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 days'),
  created_at timestamptz not null default now(),
  check (char_length(device_player_id) between 8 and 128),
  check (char_length(reason) between 1 and 120)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_rooms_updated_at
before update on public.rooms
for each row execute function public.set_updated_at();

create trigger set_rounds_updated_at
before update on public.rounds
for each row execute function public.set_updated_at();

create trigger set_answers_updated_at
before update on public.answers
for each row execute function public.set_updated_at();

create trigger set_category_packs_updated_at
before update on public.category_packs
for each row execute function public.set_updated_at();

create index rooms_code_idx on public.rooms(code);
create index rooms_expires_at_idx on public.rooms(expires_at);
create index room_players_room_id_idx on public.room_players(room_id);
create index room_players_device_player_id_idx on public.room_players(device_player_id);
create index rounds_room_id_idx on public.rounds(room_id);
create index answers_round_id_idx on public.answers(round_id);
create index answers_room_player_id_idx on public.answers(room_player_id);
create index votes_answer_id_idx on public.votes(answer_id);
create index round_scores_round_id_idx on public.round_scores(round_id);
create index reports_room_id_idx on public.reports(room_id);
create index reports_status_idx on public.reports(status);
create index abuse_strikes_device_player_id_idx on public.abuse_strikes(device_player_id);
create index abuse_strikes_expires_at_idx on public.abuse_strikes(expires_at);

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.rounds enable row level security;
alter table public.answers enable row level security;
alter table public.votes enable row level security;
alter table public.round_scores enable row level security;
alter table public.category_packs enable row level security;
alter table public.categories enable row level security;
alter table public.reports enable row level security;
alter table public.abuse_strikes enable row level security;

grant usage on schema public to anon, authenticated;
grant select, insert, update on
  public.rooms,
  public.room_players,
  public.rounds,
  public.answers,
  public.votes,
  public.round_scores,
  public.category_packs,
  public.categories,
  public.reports,
  public.abuse_strikes
to anon, authenticated;

create policy "rooms beta readable" on public.rooms for select using (true);
create policy "rooms beta insertable" on public.rooms for insert with check (true);
create policy "rooms beta updatable while active" on public.rooms for update using (status <> 'finished');

create policy "room players beta readable" on public.room_players for select using (true);
create policy "room players beta insertable" on public.room_players for insert with check (true);
create policy "room players beta updatable" on public.room_players for update using (true);

create policy "rounds beta readable" on public.rounds for select using (true);
create policy "rounds beta insertable" on public.rounds for insert with check (true);
create policy "rounds beta updatable" on public.rounds for update using (true);

create policy "answers beta readable" on public.answers for select using (true);
create policy "answers beta insertable" on public.answers for insert with check (true);
create policy "answers beta updatable" on public.answers for update using (true);

create policy "votes beta readable" on public.votes for select using (true);
create policy "votes beta insertable" on public.votes for insert with check (true);
create policy "votes beta updatable" on public.votes for update using (true);

create policy "round scores beta readable" on public.round_scores for select using (true);
create policy "round scores beta insertable" on public.round_scores for insert with check (true);
create policy "round scores beta updatable" on public.round_scores for update using (true);

create policy "category packs beta readable" on public.category_packs for select using (true);
create policy "category packs beta insertable" on public.category_packs for insert with check (true);
create policy "category packs beta updatable" on public.category_packs for update using (true);

create policy "categories beta readable" on public.categories for select using (true);
create policy "categories beta insertable" on public.categories for insert with check (true);
create policy "categories beta updatable" on public.categories for update using (true);

create policy "reports beta insertable" on public.reports for insert with check (true);
create policy "reports beta readable" on public.reports for select using (true);

create policy "abuse strikes beta insertable" on public.abuse_strikes for insert with check (true);
create policy "abuse strikes beta readable" on public.abuse_strikes for select using (true);

insert into public.category_packs (name, slug, description, is_default)
values ('Classic', 'classic', 'Default Animal Name Place starter pack.', true);

insert into public.categories (pack_id, name, sort_order)
select id, category_name, sort_order
from public.category_packs
cross join (
  values
    ('Name', 1),
    ('Place', 2),
    ('Animal', 3),
    ('Food', 4),
    ('Object', 5),
    ('Job', 6),
    ('Brand', 7)
) as starter(category_name, sort_order)
where slug = 'classic';
