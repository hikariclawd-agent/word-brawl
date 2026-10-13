-- The mobile vote path now uses submit_answer_vote_command().
-- Keep reads available for reveal screens, but remove client-side mutation paths.

revoke insert, update, delete on public.votes from anon, authenticated;
