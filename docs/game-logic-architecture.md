# Word Brawl game logic architecture

## Design goal

Shared answer normalisation and scoring primitives must remain consistent across local play, CPU practice, Supabase room services, tests, and future web clients. Local CPU simulation is a client-side path; public online verdicts, points and disputes remain server-authoritative. React screens and network code are adapters around those boundaries.

## Core API

`packages/game-core/src/match.ts` contains the pure match state machine:

- `createMatch(input)` creates serialisable state.
- `reduceMatch(state, action)` applies one legal transition.
- `calculateRoundScores(state)` calculates a round without side effects.
- `findDuplicateAnswerKeys(answers)` detects duplicates by category.

The state is JSON-safe and includes:

- `schemaVersion` for migrations.
- `matchId` for persistence and reconciliation.
- `revision` for optimistic concurrency and stale-update detection.
- `rules` for versioned, mode-specific behaviour.
- `history` for replay, dispute review, and analytics.

## Scaling rules

1. **Rules are configuration, not scattered constants.** Classic, Blitz, themed, and future paid modes can supply different scores, limits, and penalties through `MatchRules`.
2. **Actions are the boundary.** UI, bots, and online services send actions; only the reducer changes match state.
3. **State is serialisable.** It can be stored locally, sent through Supabase, replayed in tests, or moved to a server-authoritative worker later.
4. **Revisions prevent stale writes.** Online persistence should accept an update only when its expected revision matches the stored revision.
5. **Ruleset versions protect old matches.** A match stores the ruleset version used to score it; changing future rules must not rewrite historical results.
6. **History supports replay and moderation.** Each completed round stores answers, verdicts, and score breakdowns.
7. **Network code stays outside core.** Supabase subscriptions, retries, authentication, and reconnect behaviour belong in services/adapters.
8. **Randomness stays at the edge.** Choose a letter outside the reducer and pass it in as an action, so tests and replays remain deterministic.

## Unverified follow-ups

- A complete local and online replay fixture covering a full round is not yet established by the current test inventory.
- Full server/SQL parity and physical Android behaviour remain unverified.
- Adopting this reducer as the local hook's state engine is not implemented and should be treated as a separate, explicitly approved refactor rather than assumed to be complete.
