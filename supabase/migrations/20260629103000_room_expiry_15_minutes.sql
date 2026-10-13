alter table public.rooms
alter column expires_at set default (now() + interval '15 minutes');
