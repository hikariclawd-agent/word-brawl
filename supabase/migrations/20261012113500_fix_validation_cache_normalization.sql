-- Preserve uppercase first letters before normalising. The previous expression
-- stripped uppercase letters before lowercasing, turning "Cromulent" into
-- "romulent".

create or replace function public.normalize_live_brawl_answer(p_answer_text text)
returns text
language sql
immutable
as $$
  select regexp_replace(lower(trim(coalesce(p_answer_text, ''))), '[^a-z0-9]+', '', 'g');
$$;
