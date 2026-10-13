# Word Brawl game logic architecture

## Design goal

The game rules must run identically in local play, CPU practice, Supabase room services, tests, and future web clients. React screens and network code are adapters; they do not own scoring or phase transitions.

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

## Next engineering steps

1. Replace duplicated local scoring in `useLocalGame.ts` with this reducer.
2. Add a local adapter that translates hook events into match actions.
3. Add command permissions for host, player, and moderator actions.
4. Add server-side revision checks to online room writes.
5. Add migration functions when `schemaVersion` changes.
6. Add replay fixtures for a complete local and online round.
