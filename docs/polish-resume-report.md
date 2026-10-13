# Word Brawl polish resume report

## Scope audited

- Mobile entry point: `apps/mobile/App.tsx`.
- Session state and restore path: `apps/mobile/src/useLocalGame.ts`.
- Online room lifecycle: `apps/mobile/src/onlineRooms.ts`.
- Shared scoring rules stay in `packages/game-core`; no game-rule changes were made.

## Existing polish confirmed

- Scoring uses the active `renderScoringSwipeDeck()` path. The legacy score/waiting/action tree is deliberately retained for those states, but is unmounted—not hidden—while `renderCompactReview()` is active.
- Review uses `renderCompactReview()`, which becomes a two-column list/detail layout on wide screens and an answer detail sheet on narrow screens.
- How to Play has separate desktop and stacked web rules layouts.
- Answer inputs explicitly set `autoComplete="off"`, `autoCorrect={false}`, `spellCheck={false}`, `autoCapitalize="none"`, and `importantForAutofill="no"`.
- Haptics are stored in AsyncStorage, expose a Settings toggle, use native Vibration or optional browser vibration, and catch feedback errors. Score choices, joining a session, starting a round, answer submission, and timeout errors use the optional feedback.

## Changes made

- Centralized the twelve-second reconnect decision in `isWithinReconnectGrace`.
- Room snapshots now retain a recently disconnected player in their original seat for the grace period. Their player id continues to anchor saved answers, scores, and votes.
- Automatic restore, direct room join, and public matchmaking now enforce the same 12-second window. A stale disconnected/left seat is no longer silently reactivated.
- Added the pure `reconnect.ts` decision module and mobile Vitest coverage. The explicit decision is `insert`, `reactivate`, or `reject`, so an existing in-grace device seat reuses its row id rather than creating a duplicate.
- Updated the departure notice to accurately describe the 12-second preserved-seat behavior.
- Added optional feedback to live/private joins and starting a round.
- The legacy scoring tree is now unmounted while the compact review is active; it is not merely hidden. The remaining legacy scoring tree is still used for the score/waiting/action states, so it was deliberately retained.

## Verification

- Final: `corepack pnpm --recursive typecheck` passed.
- Final: `corepack pnpm --recursive --if-present test` passed: 20 game-core tests plus 4 mobile reconnect tests.
- The reconnect tests cover the exact 12,000 ms boundary, 12,001 ms expiry, invalid timestamps, active and in-grace identity reuse, new-seat insertion, and terminal/expired-seat rejection.
- Playwright exercised local Practice gameplay through answer entry, submission, score selection, review, and answer details at 390x900, 430x900, 768x900, and 1440x900. No console or page errors occurred. At small widths the answer detail sheet opened and closed; tablet/desktop used the inline detail path.
- All five answer fields exposed `autocomplete=off`, `autocapitalize=none`, `autocorrect=off`, and `spellcheck=false` in the live web DOM.
- Playwright toggled Haptics off and on and refreshed between each check; the preference persisted both ways. This verifies the web setting storage path, not physical device vibration.
- Screenshots: `docs/polish-desktop.png`, `docs/polish-mobile.png`, `docs/polish-scoring-mobile.png`, `docs/polish-review-mobile.png`, and `docs/polish-review-{390,430,768,1440}.png`.
- `expo config --type public` validated the native manifest path: Android package `com.anonymous.animalnameplace`, portrait orientation, iOS tablet support, and web config are present.
- A separate Expo web server was started with ephemeral process-only local Supabase URL/anon-key overrides; neither `.env.local` nor the hosted backend was changed. Two isolated Chromium contexts created and joined a Private Brawl, both entered/submitted answers after the host started a round, and both reached the score/reveal transition. In a separate run, the guest restored the same active-round seat after a context-close/reopen within the 12-second window.
- Direct local database inspection of that test room found exactly two `room_players` rows and two distinct device identities after the rejoin (no duplicate seat). The local Supabase schema has `rooms` and `room_players` and all 24 project migrations applied.

## Limits / remaining device checks

- No physical Android/iOS device was available, so native vibration and Expo Go rendering were not claimed as tested.
- The local test verified in-grace restoration. The post-12-second rejection path is covered by the deterministic mobile boundary test (12,001 ms); a full browser wait-through test was not repeated because the client cleanup timer is process-owned and closes with a terminated browser context.
- No production/hosted room data was touched. Local test records remain only in the local development database.
