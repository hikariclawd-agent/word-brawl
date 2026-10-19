# Verification retry — 2026-10-19

Preserved intervening implementation changes. Current requirement is five seats, sequential 650ms human-search windows; the earlier 300ms/four-seat report is historical, not the current configuration.

Re-run completed successfully:
- Recursive TypeScript checks. The normal pretypecheck/pretest script refreshed generated build metadata.
- 216 tests: 38 game-core and 178 mobile.
- SQL authority rollback suite: five seats, sequential fill, no replacement, replay, permissions, snapshots, reconnect.
- Eight concurrent joins and advances: target five, one round, late-join exclusion, sequential bot fill, eight identical snapshots.
- Bot diversity rollback suite: seven identities, twenty stable rounds, different fill behavior, shared-word scores.

Browser regression attempt timed out before app load: local host load exceeded 90 and swap was full. Existing Metro on port 8091 eventually built the bundle in 591 seconds. No restart or application edits were made to work around host load. Warm-bundle smoke check reached navigation but timed out after 60 seconds waiting for the exact Practice label. Its cause is not yet isolated (host pressure, changed entry flow, or rendering). No current UI pass is claimed. Older browser evidence is not a substitute for a current full UI pass.
