# Private Brawl and local debugging

## Private Brawl flow

1. The host opens **Private Brawl** and chooses **Create New Brawl**.
2. The client creates a `rooms` row with a six-character code, lobby status, settings, expiry time, and private visibility.
3. The host is inserted into `room_players` as the active host and becomes the letter picker.
4. The host shares the code.
5. A guest opens **Private Brawl**, enters the code, and the client looks up a non-expired room that is not finished.
6. The guest is inserted into the same `room_players` room and both clients poll the room snapshot.
7. The host starts the round once the players are ready. The room state then moves through lobby, active round, reveal, and scored states.

A private room is not matchmaking. It is one room identified by a shareable code.

## Local error logs

Run from the repository root:

```bash
docker logs --since=30m supabase_rest_animal-name-place 2>&1 | tail -200
docker logs --since=30m supabase_db_animal-name-place 2>&1 | grep -E 'ERROR|FATAL|violates' | tail -100
```

The Expo/Metro process is the client log. Watch it with the terminal running the web preview. Browser network failures can be checked in DevTools.

## Known code constraint

Room codes must match `^[A-Z2-9]{6}$`. The app generator uses the same six-character alphabet and the current create/join end-to-end test produced a valid room and a second player joined it.
