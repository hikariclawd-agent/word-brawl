drop policy if exists "rooms beta updatable while active" on public.rooms;

create policy "rooms beta updatable" on public.rooms
for update
using (true)
with check (true);
