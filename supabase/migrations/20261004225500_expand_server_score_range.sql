-- Future scoring formats may use values above the original 10-point ceiling.

alter table public.answers
  drop constraint if exists answers_points_check;

alter table public.answers
  add constraint answers_points_check check (points between 0 and 100);
