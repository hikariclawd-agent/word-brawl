\set ON_ERROR_STOP on
begin;

do $$
begin
  begin
    perform public.live_brawl_v2_canonical_verdict('disputed')::text;
  exception when undefined_function then
    raise exception 'Forward-fix helper is missing';
  end;

  assert public.live_brawl_v2_canonical_verdict('disputed') = 'blank',
    'Legacy disputed verdict must enter v2 as unresolved blank';
  assert public.live_brawl_v2_canonical_verdict('valid') = 'valid',
    'Valid verdict changed during v2 normalization';
  assert public.live_brawl_v2_canonical_verdict('invalid') = 'invalid',
    'Invalid verdict changed during v2 normalization';
end;
$$;

do $$
begin
  assert exists (
    select 1
    from pg_constraint
    where conrelid = 'public.live_brawl_answer_targets'::regclass
      and conname = 'live_brawl_answer_targets_canonical_verdict_check'
      and pg_get_constraintdef(oid) not ilike '%disputed%'
  ), 'The v2 canonical CHECK must continue rejecting disputed';
end;
$$;

rollback;
