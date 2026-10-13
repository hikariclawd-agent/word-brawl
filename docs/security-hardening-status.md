# Word Brawl security hardening status

## Completed locally

- Authoritative answer submission RPC with room locking, membership checks, timer checks, revision checks, and idempotent command IDs.
- Authoritative answer-vote RPC with room locking, membership checks, reveal-phase checks, revision checks, unique voter/answer enforcement, and idempotent command IDs.
- Server-side majority resolution and answer-point writes inside the vote transaction.
- Server-owned configurable scoring maps on each room, with a 0–100 score range.
- Mobile vote submission now calls the authoritative RPC instead of writing `votes` or `answers` directly.
- The primary mobile answer submission now calls `submit_answer_command()` with a revision and command ID.
- Direct `votes` insert/update/delete privileges revoked from `anon` and `authenticated` locally.
- `match_commands` audit log for accepted commands.
- Local transaction tests for answer and vote idempotency.

## Still intentionally open during beta compatibility

The mobile app still has legacy blank-row finalisation, bot verdict, dispute, score, and room writes, and most beta RLS policies remain permissive. Do not call the system production-secure yet.

Scoring is deliberately not frozen to the current confusing format. `rooms.scoring_rules` now owns the server-side map, so a future ruleset can change values without trusting the client or rewriting command handlers.

## Next security work

1. Move answer submission in `onlineRooms.ts` to the authoritative RPC.
2. Move dispute votes and verdict resolution into server functions.
3. Revoke direct client writes to `answers`, `round_scores`, disputes, and sensitive room fields.
4. Restrict reads by room membership and game phase.
5. Replace device IDs with authenticated users or signed guest sessions.
6. Add rate limits for room creation, joins, submissions, votes, and reports.
7. Add invite-token hashing and room-code abuse controls.
8. Add monitoring and suspicious-command alerts.
