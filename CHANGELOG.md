# Changelog

All notable Word Brawl changes are recorded here. Released entries are historical; unreleased work stays under `Unreleased` until a deliberate version decision is approved.

## [Unreleased]

### DB

- Add the Live Brawl v2 actor, answer-target, cyclic assignment, score-decision, dispute, and round-score authority tables and commands.
- Migration: `20261021140000_live_brawl_player_scoring_contract`.
- Migration: `20261021150000_harden_live_brawl_scoring_authority` adds actor-count/category guards, dispute capability/deadline checks, and server-only helper permissions.
- Migration: `20261021160000_live_brawl_reveal_materialization` invokes the server-only v2 materializer at eligible public five-seat reveal while preserving legacy bot snapshots and v1 rooms.
- Proposed release manifest: `release-manifests/1.2.0.json` records the complete migration chain, including the three migrations omitted from historical `1.1.0`: `20261018090000_fix_dispute_points_persistence`, `20261019213000_allow_designated_picker_start_round`, and `20261019224500_live_brawl_five_second_search`.

### TEST

- Add the five-actor/four-category SQL contract fixture.
- Add reveal-boundary regression coverage for automatic actor/target/assignment creation, idempotency, v1 compatibility, scoring, disputes, and round completion.
- Add TypeScript coverage for 20 targets, 20 assignments, deterministic rotation, and self-scoring rejection.

### Compatibility

- Existing app version `1.1.0`, Android versionCode `9`, legacy scoring tables, and ruleset v1 rooms remain unchanged.
- Ruleset v2 is isolated to the repaired Live Brawl path and is not deployed by this branch.
- The historical `release-manifests/1.1.0.json` remains unchanged.

### Known limitations

- The migration has been transactionally syntax-tested against the local development database only.
- Staging/production deployment, browser gameplay, native builds, and end-to-end runtime acceptance are not included in this change.
