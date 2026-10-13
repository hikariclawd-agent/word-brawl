create table public.answer_disputes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  answer_id uuid not null references public.answers(id) on delete cascade,
  opened_by_player_id uuid references public.room_players(id) on delete set null,
  status text not null default 'open',
  final_verdict public.vote_verdict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  check (status in ('open', 'resolved'))
);

create unique index answer_disputes_one_open_per_answer_idx
on public.answer_disputes(answer_id)
where status = 'open';

create index answer_disputes_round_id_idx on public.answer_disputes(round_id);
create index answer_disputes_answer_id_idx on public.answer_disputes(answer_id);

create table public.answer_dispute_votes (
  id uuid primary key default gen_random_uuid(),
  dispute_id uuid not null references public.answer_disputes(id) on delete cascade,
  voter_player_id uuid not null references public.room_players(id) on delete cascade,
  verdict public.vote_verdict not null,
  created_at timestamptz not null default now(),
  unique (dispute_id, voter_player_id)
);

create index answer_dispute_votes_dispute_id_idx on public.answer_dispute_votes(dispute_id);
create index answer_dispute_votes_voter_player_id_idx on public.answer_dispute_votes(voter_player_id);

alter table public.answer_disputes enable row level security;
alter table public.answer_dispute_votes enable row level security;

grant select, insert, update on
  public.answer_disputes,
  public.answer_dispute_votes
to anon, authenticated;

create policy "answer disputes beta readable" on public.answer_disputes for select using (true);
create policy "answer disputes beta insertable" on public.answer_disputes for insert with check (true);
create policy "answer disputes beta updatable" on public.answer_disputes for update using (true);

create policy "answer dispute votes beta readable" on public.answer_dispute_votes for select using (true);
create policy "answer dispute votes beta insertable" on public.answer_dispute_votes for insert with check (true);
create policy "answer dispute votes beta updatable" on public.answer_dispute_votes for update using (true);
