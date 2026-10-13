-- Keep answer validation inside the server-authoritative scoring path.
-- Unknown or source-missing answers are reviewable, not automatically invalid.

create table if not exists public.word_validation_cache (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  normalized_answer text not null,
  display_answer text not null,
  verdict public.answer_verdict not null,
  confidence numeric(4,3) not null default 0.5,
  source text not null default 'manual',
  source_ref text,
  failure_reason text,
  checked_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  usage_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(category) between 1 and 40),
  check (char_length(normalized_answer) between 1 and 120),
  check (char_length(display_answer) between 1 and 120),
  check (verdict in ('valid', 'duplicate', 'variant', 'invalid', 'disputed')),
  check (confidence >= 0 and confidence <= 1),
  check (char_length(source) between 1 and 80),
  unique (category, normalized_answer)
);

create trigger set_word_validation_cache_updated_at
before update on public.word_validation_cache
for each row execute function public.set_updated_at();

create index if not exists word_validation_cache_lookup_idx
  on public.word_validation_cache(category, normalized_answer, verdict);

alter table public.word_validation_cache enable row level security;
revoke all on public.word_validation_cache from public, anon, authenticated;
grant select on public.word_validation_cache to anon, authenticated;

drop policy if exists "word validation cache readable" on public.word_validation_cache;
create policy "word validation cache readable" on public.word_validation_cache
for select using (true);

create or replace function public.normalize_live_brawl_answer(p_answer_text text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(trim(coalesce(p_answer_text, '')), '[^a-z0-9]+', '', 'g'));
$$;

create or replace function public.answer_points_for_verdict(p_verdict public.answer_verdict)
returns integer
language sql
immutable
as $$
  select case p_verdict
    when 'valid' then 10
    when 'duplicate' then 5
    when 'variant' then 5
    else 0
  end;
$$;

create or replace function public.validate_live_brawl_answer(
  p_answer_text text,
  p_category text,
  p_letter text
)
returns public.answer_verdict
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_answer text := trim(coalesce(p_answer_text, ''));
  normalized_answer_value text := public.normalize_live_brawl_answer(p_answer_text);
  cached_verdict public.answer_verdict;
begin
  if clean_answer = '' then
    return 'blank'::public.answer_verdict;
  end if;

  if p_letter is not null and upper(left(clean_answer, 1)) <> p_letter then
    return 'invalid'::public.answer_verdict;
  end if;

  select verdict into cached_verdict
  from public.word_validation_cache
  where category = p_category
    and normalized_answer = normalized_answer_value
  order by checked_at desc
  limit 1;

  if cached_verdict is not null then
    update public.word_validation_cache
    set last_used_at = clock_timestamp(),
        usage_count = usage_count + 1
    where category = p_category
      and normalized_answer = normalized_answer_value;

    return cached_verdict;
  end if;

  if exists (
    select 1
    from public.bot_word_bank bw
    where bw.category = p_category
      and public.normalize_live_brawl_answer(bw.word) = normalized_answer_value
  ) then
    return 'valid'::public.answer_verdict;
  end if;

  if exists (
    select 1
    from public.bot_word_bank bw
    where bw.category <> p_category
      and public.normalize_live_brawl_answer(bw.word) = normalized_answer_value
  ) then
    return 'invalid'::public.answer_verdict;
  end if;

  insert into public.word_validation_cache (
    category,
    normalized_answer,
    display_answer,
    verdict,
    confidence,
    source,
    failure_reason,
    usage_count
  ) values (
    p_category,
    normalized_answer_value,
    clean_answer,
    'disputed'::public.answer_verdict,
    0.25,
    'server_fallback',
    'No local category match; reviewable until enriched.',
    1
  )
  on conflict (category, normalized_answer)
  do update set
    display_answer = excluded.display_answer,
    last_used_at = clock_timestamp(),
    usage_count = public.word_validation_cache.usage_count + 1;

  return 'disputed'::public.answer_verdict;
end;
$$;

create or replace function public.live_brawl_auto_vote(
  p_answer_text text,
  p_category text,
  p_letter text
)
returns public.vote_verdict
language plpgsql
set search_path = public
as $$
declare
  validation_result public.answer_verdict;
begin
  validation_result := public.validate_live_brawl_answer(p_answer_text, p_category, p_letter);

  if validation_result in ('valid', 'duplicate', 'variant', 'invalid') then
    return validation_result::text::public.vote_verdict;
  end if;

  -- A missing category record is not proof of invalidity. For forced timeout
  -- votes we keep play moving with a soft variant instead of a rejection.
  return 'variant'::public.vote_verdict;
end;
$$;

create or replace function public.auto_score_solo_live_brawl_answer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  round_row public.rounds%rowtype;
  eligible_voter_count integer;
  resolved_verdict public.answer_verdict;
begin
  if coalesce(new.answer_text, '') = '' then
    return new;
  end if;

  if new.verdict <> 'blank'::public.answer_verdict or new.points <> 0 then
    return new;
  end if;

  select *
  into round_row
  from public.rounds
  where id = new.round_id;

  if not found then
    return new;
  end if;

  select count(*)::integer
  into eligible_voter_count
  from public.room_players rp
  where rp.room_id = round_row.room_id
    and rp.role = 'player'
    and rp.status = 'active'
    and rp.id <> new.room_player_id;

  if eligible_voter_count = 0 then
    resolved_verdict := public.validate_live_brawl_answer(new.answer_text, new.category, round_row.letter);
    new.verdict := resolved_verdict;
    new.points := public.answer_points_for_verdict(resolved_verdict);
    new.updated_at := clock_timestamp();
  end if;

  return new;
end;
$$;

with solo_answers as (
  select
    a.id,
    public.validate_live_brawl_answer(a.answer_text, a.category, rd.letter) as resolved_verdict
  from public.answers a
  join public.rounds rd on rd.id = a.round_id
  where a.answer_text <> ''
    and a.verdict = 'blank'::public.answer_verdict
    and not exists (
      select 1
      from public.room_players rp
      where rp.room_id = rd.room_id
        and rp.role = 'player'
        and rp.status = 'active'
        and rp.id <> a.room_player_id
    )
)
update public.answers a
set verdict = solo_answers.resolved_verdict,
    points = public.answer_points_for_verdict(solo_answers.resolved_verdict),
    updated_at = clock_timestamp()
from solo_answers
where a.id = solo_answers.id;

do $$
declare
  score_row record;
begin
  for score_row in
    select distinct a.round_id, a.room_player_id
    from public.answers a
    join public.rounds rd on rd.id = a.round_id
    where a.answer_text <> ''
      and not exists (
        select 1
        from public.room_players rp
        where rp.room_id = rd.room_id
          and rp.role = 'player'
          and rp.status = 'active'
          and rp.id <> a.room_player_id
      )
  loop
    perform public.refresh_live_brawl_round_score(score_row.round_id, score_row.room_player_id);
  end loop;
end $$;

grant execute on function public.normalize_live_brawl_answer(text) to anon, authenticated;
grant execute on function public.answer_points_for_verdict(public.answer_verdict) to anon, authenticated;
grant execute on function public.validate_live_brawl_answer(text, text, text) to anon, authenticated;
