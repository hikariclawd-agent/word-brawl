# Changelog

All notable Word Brawl changes are recorded here. Released entries are historical; unreleased work stays under `Unreleased` until a deliberate version decision is approved.

## [Unreleased]

### DB

- Add the Live Brawl v2 actor, answer-target, cyclic assignment, score-decision, dispute, and round-score authority tables and commands.
- Migration: `20261021140000_live_brawl_player_scoring_contract`.

### TEST

- Add the five-actor/four-category SQL contract fixture.
- Add TypeScript coverage for 20 targets, 20 assignments, deterministic rotation, and self-scoring rejection.

### Compatibility

- Existing app version `1.1.0`, Android versionCode `9`, legacy scoring tables, and ruleset v1 rooms remain unchanged.
- Ruleset v2 is isolated to the repaired Live Brawl path and is not deployed by this branch.

### Known limitations

- The migration has been transactionally syntax-tested against the local development database only.
- Staging/production deployment, browser gameplay, native builds, and end-to-end runtime acceptance are not included in this change.
