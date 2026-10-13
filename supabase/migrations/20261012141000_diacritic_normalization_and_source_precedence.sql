-- Fold common Latin diacritics before answer lookup so names and places such
-- as accented/unaccented Elodie, Sao Paulo, Lodz, and Munchen/Munich variants
-- do not become false misses just because the source text includes accents.

create or replace function public.normalize_live_brawl_answer(p_answer_text text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(
    replace(replace(replace(replace(replace(replace(
      translate(
        trim(coalesce(p_answer_text, '')),
        'ÀÁÂÃÄÅĀĂĄàáâãäåāăąÇĆĈĊČçćĉċčÐĎĐðďđÈÉÊËĒĔĖĘĚèéêëēĕėęěÌÍÎÏĨĪĬĮİìíîïĩīĭįıÑŃŅŇñńņňÒÓÔÕÖØŌŎŐòóôõöøōŏőŔŖŘŕŗřŚŜŞŠśŝşšÙÚÛÜŨŪŬŮŰŲùúûüũūŭůűųÝŶŸýÿŷŹŻŽźżžŁłÞþ',
        'AAAAAAAAAaaaaaaaaaCCCCCcccccDDDdddEEEEEEEEEeeeeeeeeeIIIIIIIIIiiiiiiiiiNNNNnnnnOOOOOOOOOoooooooooRRRrrrSSSSssssUUUUUUUUUUuuuuuuuuuuYYYyyyZZZzzzLlTt'
      ),
      'Æ', 'AE'),
      'æ', 'ae'),
      'Œ', 'OE'),
      'œ', 'oe'),
      'ß', 'ss'),
      'ẞ', 'SS'
    ),
    '[^a-zA-Z0-9]+',
    '',
    'g'
  ));
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
  normalized_letter text := upper(left(public.normalize_live_brawl_answer(p_letter), 1));
  cached_verdict public.answer_verdict;
begin
  if clean_answer = '' then
    return 'blank'::public.answer_verdict;
  end if;

  if normalized_letter <> '' and upper(left(normalized_answer_value, 1)) <> normalized_letter then
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

    if cached_verdict = 'disputed'::public.answer_verdict then
      perform public.enqueue_word_validation_enrichment(p_category, normalized_answer_value, clean_answer);
    end if;

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
    usage_count,
    enrichment_status,
    enrichment_requested_at
  ) values (
    p_category,
    normalized_answer_value,
    clean_answer,
    'disputed'::public.answer_verdict,
    0.25,
    'server_fallback',
    'No local category match; reviewable until enriched.',
    1,
    'pending'::public.word_validation_enrichment_status,
    clock_timestamp()
  )
  on conflict (category, normalized_answer)
  do update set
    display_answer = excluded.display_answer,
    last_used_at = clock_timestamp(),
    usage_count = public.word_validation_cache.usage_count + 1,
    enrichment_requested_at = coalesce(public.word_validation_cache.enrichment_requested_at, clock_timestamp());

  perform public.enqueue_word_validation_enrichment(p_category, normalized_answer_value, clean_answer);

  return 'disputed'::public.answer_verdict;
end;
$$;

grant execute on function public.normalize_live_brawl_answer(text) to anon, authenticated;
grant execute on function public.validate_live_brawl_answer(text, text, text) to anon, authenticated;
