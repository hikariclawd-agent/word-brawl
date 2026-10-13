# Live backend contract (implemented, locally verified)

- `findOrCreatePublicRoom` retains signature, becomes atomic server matchmaking. Human window is 300ms from room creation; advance before deadline returns lobby/null. At deadline advance fills ALL missing seats to target 4 and starts exactly one round. No change to configured roundSeconds.
- `advanceLiveBrawlSession` retains signature. Poll at/after 300ms; credentials supplied internally.
- `updateOnlineRoomSettings` retains signature; server verifies room-scoped host + device + private capability, lobby and not started. Existing legacy rooms without capability must be recreated to edit securely.
- NEW `getOnlineBotRoundSnapshot(roomId: string, roundId: string): Promise<OnlineBotRoundSnapshot>`; `{ roomId, roundId, bots: OnlineBotRound[] }`. Each bot `{ playerId: "bot-1", playerName, personality: string, answers: Array<{category: StarterCategory, answer: string, verdict: AnswerVerdict, points: number}>, answeredCount: number, score: number, totalScore: number }`. Public live bots are generated on server, persisted and identical across clients/reconnects; private/practice keep their existing local manual-scoring workflow. Use bot playerName/personality for roster; score and totalScore for round/match standings. Snapshot supports private rooms too. Call on reveal (not typing); server withholds answers until reveal or timer expiry.
- Bot verdicts immutable for this minimal version; do not send synthetic bot IDs to human answer/vote RPCs. Human scoring remains existing boundary.
- Server bank seeded from existing static BOT_WORD_BANK; stable per-room names and personalities, deterministic category choices, fill and typo profiles. No LLM.

Security scope: protect settings columns against direct writes; new private capability table never readable by clients. Existing broad legacy human answer/lifecycle writes are not claimed fully hardened.

## Implementation / verification

- Applied additive local migrations 20261010113000 through 20261010113500 with Supabase migration up --local. No reset, remote deployment, or gateway changes.
- createOnlineRoom/joinOnlineRoom now use managed RPCs; capabilities issued by DB and stored in AsyncStorage, never returned in public table reads. Public join double-taps coalesce. Rejoin retains player ID, capability and original scores within 12 seconds.
- Direct settings writes and host/device identity updates denied to anon/authenticated; separate-room host, wrong device, nonhost and forged capability rejected. Server transfers management to an active capability-bearing member after host becomes left/kicked/timed_out/banned.
- All public inserts lock the room and reject full/late seats, including legacy direct insert attempts. Room advance ignores caller roundSeconds and uses configured room value; target is fixed at 4.
- Bot snapshots materialize automatically on reveal/scored transition, so historical totals survive clients skipping snapshot fetches. Typed snapshot API still available on reveal or timer expiry. Bots use protected 547-word server bank, seven stable profiles and distinct fill/typo probabilities.
- Verification passed: rollback SQL assertions (window, atomic fill, unchanged timer, replay, real anon permissions, cross-room/device/capability rejection, snapshots and reconnect); real 8-client concurrent joins and 8 advances produce exactly one round and max four seats, late join exclusion; 8 simultaneous snapshots identical, including solo + 3 bots. Typecheck passed; existing plus parent-added tests passed (29).

## Final integration updates
- Applied 20261010131000 and 20261010131800 locally: pre-reveal roster API shares the same compatible personality names as snapshots; simple/long word pools differ, shared-word bot scoring restored. See live-improvements-report.md for final UI and test evidence.

## Honest remaining boundaries

- This is not a full account-auth migration. Legacy presence, human answer/round/lifecycle writes remain broad. Settings and the new bot snapshot storage are protected; do not describe all gameplay as tamper-proof.
- Existing rooms without new capabilities cannot securely edit/advance through new APIs; recreate them. New rooms reconnect normally. Host migration requires another managed member (new private join path issues capability too).
- Public bot verdicts are server results. Follow-up migration 20261010131800 restores shared-word scoring against bots and submitted humans. Human dispute voting on synthetic bot IDs is not exposed; public bot scores cannot be overwritten locally. Private/practice manual scoring remains unchanged.
- No scheduler is introduced: 300ms is an enforced human eligibility window; actual advance happens at the client's next call after deadline (network/poll delay can make visible wait longer).

Commands: 
- docker exec -i supabase_db_animal-name-place psql -v ON_ERROR_STOP=1 -U postgres -d postgres < supabase/tests/live_room_authority.sql
- python3 supabase/tests/live_room_concurrency.py (isolated bucket fixtures cleaned in finally; actual cross-connection concurrency cannot share rollback transaction)
- corepack pnpm typecheck; corepack pnpm test
