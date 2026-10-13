create type public.word_entry_status as enum ('candidate', 'accepted', 'rejected');

create table public.word_entries (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  word text not null,
  normalized_word text not null,
  source text not null default 'player',
  status public.word_entry_status not null default 'candidate',
  usage_count integer not null default 1,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(category) between 1 and 40),
  check (char_length(word) between 1 and 80),
  check (char_length(normalized_word) between 1 and 80),
  check (char_length(source) between 1 and 80),
  check (usage_count >= 0),
  unique (category, normalized_word)
);

create trigger set_word_entries_updated_at
before update on public.word_entries
for each row execute function public.set_updated_at();

create index word_entries_category_status_idx on public.word_entries(category, status);
create index word_entries_normalized_word_idx on public.word_entries(normalized_word);

alter table public.word_entries enable row level security;

grant select, insert, update on public.word_entries to anon, authenticated;

create policy "word entries beta readable" on public.word_entries
for select using (true);

create policy "word entries beta insertable" on public.word_entries
for insert with check (true);

create policy "word entries beta updatable" on public.word_entries
for update using (true);
