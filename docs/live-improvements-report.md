# Live Brawl improvements — 2026-10-10

## Implemented in the existing app
- Public matchmaking: server-enforced 300ms human eligibility window, atomic remaining-seat fill to four, room locks, single-flight join/advance, retry state, unchanged round duration. Network/React scheduling overhead is additional to the window.
- Practice: compact summary with accessible Read More / Show Less, reset on navigation, full-width desktop text.
- Brawl editing: explicit prepopulated draft, name/description plus existing rounds/timer/categories/CPU difficulty/scoring controls, Save/Cancel. No draft network writes. Save updates the same room. Server requires room-specific host capability; direct settings writes are revoked. Started rooms and public matchmaking UI are locked.
- Settings: text copy has a bounded flexible container; setup title row wraps. Matchmaking loading indicator no longer compresses narrow-screen text.
- Bots: original ten local/practice personalities preserved, differentiated simple/long word choices added. Public bots use seven compatible profiles with distinct word pools, fill and typo rates, unique identities within the match, varied room-seeded roster, shared server answers/results and pre-reveal identities. Shared words receive reduced bot points. No LLM calls, hidden-human-answer strategy, or adaptive difficulty.

## Modified source
- apps/mobile/App.tsx
- apps/mobile/src/useLocalGame.ts
- apps/mobile/src/onlineRooms.ts
- apps/mobile/src/liveMatchmaking.ts (new)
- apps/mobile/src/botStrategy.ts (new)
- apps/mobile/src/liveImprovements.test.ts (new)
- supabase/migrations/20261010113000* through 20261010113500*, 20261010131000_live_bot_identity_consistency.sql, 20261010131800_live_bot_shared_words.sql
- supabase/tests/live_room_authority.sql, live_room_concurrency.py, live_bot_diversity.sql
- scripts/verify-live-ui.cjs

## Verification
Baseline typecheck and 24 tests passed. Current tests: 29 passed; recursive typecheck passed.
Local SQL rollback assertions passed: 300ms boundary, remaining slots, unchanged 120-second configured timer despite caller requesting 30, idempotent advance, same-room host permission, wrong device/capability/cross-room host/nonhost denial, direct-write restrictions, withheld pre-reveal answers, replay stability, reconnect.
Actual eight-connection join/advance race: max four seats, exactly one round, late join excluded; eight simultaneous snapshots identical.
Bot diversity SQL: seven unique profiles, twenty reproducible rounds, differing fill behavior, shared-word scores, pre-reveal identities match snapshot names/personalities.
Browser: 390px and 1440px create/edit/cancel/save same record, summary expand/collapse and no horizontal overflow passed. Settings screenshots inspected at both widths: heading fits. Two isolated clients joined the same real room and entered a full-length round. Solo live match reached scoring with three server-scored CPUs, varied answers and shared scores; no page exceptions or REST errors in that pass. Longer multi-client scoring verification is recorded separately in the execution log; do not infer full-match coverage from matchmaking evidence.

Screenshots: docs/live-settings-390.png, live-settings-1440.png, live-edit-390.png, live-edit-1440.png, live-practice-compact-390.png, live-practice-expanded-1440.png, live-solo-scoring.png.

## Migration / runtime boundary
All eight new migrations are applied to LOCAL Supabase only, verified in schema_migrations. No remote deployment, database reset, dependency upgrade or gateway changes. Browser test Metro: http://127.0.0.1:8091 (local test endpoint, not an Expo Go delivery claim).
Existing rooms without management capabilities must be recreated; new managed rooms reconnect. Private/practice CPU manual scoring/challenges remain as before; authoritative public bot scores are read-only (human answer challenges remain). Public CPU challenge actions that previously changed only local state are not offered as if they change shared scores. Full account authentication and broader legacy human lifecycle hardening are outside this change. Physical iOS/Android rendering was not verified. Existing require-cycle/style deprecation warnings and failed optional RN DevTools launch are not fixed by this scoped task.
