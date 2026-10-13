# Private Beta Roadmap

## Target

- Private beta date: Sunday 2026-07-05
- Beta quality target: usable but rough
- Beta must include: real online multiplayer
- First platform: Android
- Distribution target: private APK/testing link

## Build Order

1. Scoring tests.
2. State cleanup.
3. Apply Taste Skill/design audit to remaining screens.
4. Supabase schema and migrations.
5. Supabase Realtime rooms.
6. Online round flow.
7. Feedback/reporting.
8. Beta build and smoke test.

## Milestones

### Saturday 2026-06-27

- PRD completed.
- Production checklist completed.
- Build order agreed.
- Automated scoring tests added for game-core.
- Local game state extracted from `App.tsx` into `apps/mobile/src/useLocalGame.ts`.
- Lobby and Round screens updated with the Taste Skill direction.
- Reveal/Score and Leaderboard screens updated with the Taste Skill direction.
- Room codes updated to six-character secure-readable codes.
- Initial Supabase schema migration added.
- Supabase CLI installed as local dev dependency.
- Supabase project initialized with `supabase/config.toml`.
- Typecheck and tests pass.

### Sunday 2026-06-28

- Docker Engine installed for local Supabase.
- Local Supabase stack started successfully.
- Initial migration applied to local database.
- Verified expected public tables exist.
- Added required `anon`/`authenticated` grants for beta REST access.
- Wired mobile Create Room and Join Room to local Supabase.
- Added local anonymous device player ID storage.
- Smoke tested REST create/join flow with two players.
- Expo restarted in tmux with LAN URL `exp://10.28.194.206:8081`.
- Refactor local score usage if needed.
- Continue mobile app state cleanup if needed.
- Prepare state shape for backend-owned room/session flow.

### Monday 2026-06-29

- Clean mobile app state structure.
- Separate screen state from game state.
- Keep round/session logic ready for backend ownership.
- Apply Taste Skill to Lobby and Round screens.

### Tuesday 2026-06-30

- Apply Taste Skill to Reveal/Score and Leaderboard screens.
- Create beta feedback screen.
- Add friendly error states for local flow.

### Wednesday 2026-07-01

- Create Supabase project for beta.
- Apply initial schema migration.
- Review baseline RLS policies against anonymous beta flow.

### Thursday 2026-07-02

- Wire create/join room to Supabase.
- Add temporary anonymous player IDs.
- Add room code expiry.
- Add rejoin support.

### Friday 2026-07-03

- Wire online round start, answer submit, reveal, voting, and scoring.
- Add basic realtime sync.
- Add brief reconnect grace behavior.

### Saturday 2026-07-04

- Smoke test full online flow on Android.
- Test weak internet/reconnect manually.
- Fix blocking bugs.
- Prepare beta changelog.
- Create private APK/testing build.

### Sunday 2026-07-05

- Send beta build to testers.
- Collect feedback.
- Track whether testers understand the flow and finish rounds.

## Beta Acceptance Criteria

- Two or more players can join the same online room.
- Host/shared flow can start a round.
- Players can submit answers.
- Answers reveal correctly.
- Voting/scoring works.
- Leaderboard updates.
- A disconnected player can rejoin.
- Basic feedback/report path exists.
- App is usable on Android, even if rough.

## Known Deferrals

- Full account system.
- Subscriptions and ads.
- Admin dashboard.
- Full moderation console.
- Public matchmaking.
- iOS.
- Advanced duplicate detection.
- Themed pack order.
