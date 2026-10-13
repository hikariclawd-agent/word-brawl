# Word Brawl server-authoritative infrastructure

## Current boundary

The migration `20261004222500_authoritative_answer_commands.sql` adds the first protected command path for competitive answer submission.

The mobile client calls a database function with:

- room ID
- room-player ID
- device-player ID
- command ID
- expected match revision
- answer payload

The function then:

1. Locks the room row.
2. Rejects non-active rooms.
3. Rejects stale revisions.
4. Verifies the player belongs to the room and is active.
5. Verifies an active round and timer.
6. Writes locked answers in one transaction.
7. Records an idempotent command audit row.
8. Increments the room revision.
9. Returns the new revision and round ID.

Repeated requests with the same command ID return the original result instead of writing twice.

## Why this scales

- Direct answer data can later be hidden behind the command function.
- Retries are safe because commands are idempotent.
- Revisions provide optimistic concurrency control.
- The command log supports debugging, abuse review, and replay.
- Scoring can move into the same server-authoritative command boundary without changing the mobile UI contract.

## Important beta limitation

The existing beta RLS policies still allow direct table writes for the old client flow. The new RPC is additive and has been tested locally, but it is not the only write path yet.

Before public launch:

1. Switch the mobile online flow to this RPC.
2. Move scoring and verdict resolution into server-side functions.
3. Revoke direct `answers`, `round_scores`, and sensitive `rooms` writes from clients.
4. Replace device identity checks with authenticated users or signed guest sessions.
5. Add RLS policies based on authenticated room membership.
6. Add rate limits and abuse monitoring.

Practice mode can continue using the local reducer. Live Brawl should use only server commands.
