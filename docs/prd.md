# Word Brawl PRD

## Version

- Status: Draft v1
- Date: 2026-06-27
- Owner: Mr A
- Build target: Android first

## Product Summary

Word Brawl is a mobile multiplayer word game inspired by Name, Place, Animal, Thing. Players join Live Tables or Private Tables, receive a shared letter, write answers across categories, then fight for points through scoring and disputes.

The first goal is a production-shaped MVP: small enough to ship, structured enough to secure, test, and scale later.

## Target Users

- Friends and family playing quick social rounds remotely.
- Online strangers joining lightweight game sessions later, once safety and moderation are ready.
- Small groups who want a fast party-style word game.
- Later: themed communities using category packs such as African edition, football edition, Bible edition, school edition, couples edition, and Gen Z edition.

## Problem

Classic paper-based word games are fun but awkward online. Existing digital versions can feel messy, ad-heavy, or hard to play with friends. Word Brawl should make the round flow fast, clean, competitive, and easy to understand.

## Goals

- Let at least two players complete one full private-room game.
- Make the core game loop smooth on Android.
- Keep game rules testable outside the app UI.
- Prepare the structure for online rooms, validation, category packs, and monetisation.
- Avoid shipping a prototype-shaped codebase that collapses when backend, auth, or payments arrive.
- Reach a private beta by 2026-07-05 if the scope stays tight.

## Non-Goals For MVP

- Large-scale public matchmaking beyond lightweight Live Tables.
- Offline/Bluetooth play.
- AI moderation.
- Paid packs.
- iOS release.
- Complex rankings or tournaments.
- Full dictionary validation.

## Current Implemented Local Prototype

- Home screen.
- Display name input.
- Create room.
- Join room.
- Lobby.
- Local room code generation.
- Random letter generation.
- 90-second timer.
- Category answer inputs.
- Submit answers.
- Reveal answers.
- Valid / duplicate / invalid scoring controls.
- Round total.
- Finish round.
- Leaderboard.
- Local round history.

## MVP Game Loop

1. Player opens app.
2. Player enters display name.
3. Player creates or joins a private room.
4. Host starts a round.
5. App selects a random letter.
6. Players enter answers before the timer ends.
7. Answers are revealed.
8. Players vote or mark each answer as valid, duplicate, or invalid.
9. Scores are calculated.
10. Leaderboard updates.
11. Host starts the next round.

## Product Shape Decisions

- First public access model: display name and room code, not full accounts.
- Ideal room size: 2-8 players.
- Game format: fixed round/session structure.
- Session model: each session is timed.
- Control model: shared between players, not host-only.
- Initial audience: friends first, with online strangers supported later after safety work.

## Rules Decisions

- MVP starter categories stay as Name, Place, Animal, Thing.
- Wrong-letter answers should warn players, not block submission.
- Spelling and accent variants can be accepted, but should receive half score.
- Duplicate answers should not receive full score.
- Players should only see other answers during the reveal phase.

## Validation And Scoring Decisions

- Other players should validate answers, but the answer owner can dispute a decision.
- Recommended rule: one vote per player, including the answer owner, because double votes can be abused in stranger rooms.
- Majority vote should decide normal cases.
- Disputed answers should trigger a final decision flow later.
- Duplicate answers score 5 points.
- Full valid answers score 10 points.
- Invalid answers score 0 points.
- Repeated invalid-answer streaks should deduct 5 points after 3 in a row.
- Players are allowed to vote on their own answer.

## Online Room Decisions

- Room codes should expire after 1 hour.
- Players can only join before the first round starts.
- Disconnected players should be able to rejoin with the same name.
- Rooms should support both room codes and invite links.
- Spectator mode should be supported.

## Safety And Moderation Decisions

- Players should be able to report answers.
- Offensive-word filtering should be available as an option.
- Players should be able to report and kick other players.
- Rooms should have a host/moderator role even when game control is shared.
- Abuse handling should use a rolling 5-day strike window.
- First 5 abuse events: warnings.
- Next 5 abuse events: escalating timeouts.
- Next 5 abuse events: temporary room ban.
- Further abuse after that: account ban later, once accounts exist.
- Strike count resets after 5 days.

## Monetisation Decisions

- App should be free at launch.
- Monetisation model: ads plus subscription to remove ads.
- Custom category creation should be available to paid users.
- Custom category packs can be private or shareable depending on player choice.
- First visual direction should stay simple and abstract before themed packs.

## Brand And Design Decisions

- Current name is Word Brawl.
- Brand line: Same letter. No mercy. Fastest fingers.
- Visual direction for now: simple and abstract.
- Cultural/African themes should be optional themes or category packs, not the core default brand.
- Design should be treated as a system: pattern, style, colors, typography, motion, anti-patterns, and accessibility checks.
- Recommended initial style direction: minimal and direct mobile game UI with clean abstract shapes, strong hierarchy, readable scoring states, and no generic SaaS clutter.
- Avoid for now: heavy cultural styling as the default, noisy gradients, childish visuals, card-heavy dashboard spam, and overcomplicated effects.

## Launch Decisions

- Beta testers: to be found/recruited.
- Private beta success means testers understand the game flow and can successfully finish rounds.
- First launch regions: UK and Nigeria.
- Public platform priority: Android first.
- Private beta target: end of next week from 2026-06-27, interpreted as Sunday 2026-07-05.

## Platform And Cloud Decisions

- Backend: Supabase.
- Reason: game data is relational and maps cleanly to Postgres tables such as rooms, players, rounds, answers, votes, and scores.
- Firebase remains a valid alternative, but Supabase is a cleaner fit for relational game state and Row Level Security.
- Private beta environment: one beta Supabase project for speed.
- Public launch environment: split into staging and production before wider release.
- Player identity: anonymous guest with display name first; accounts/sign-in later for subscriptions, bans, saved stats, and custom packs.
- Mobile build path: use Expo Go during development, then EAS Build for installable Android builds.
- First testing distribution: private APK/testing link.
- Later testing distribution: Google Play internal testing.
- Cost note: Supabase and Firebase both have free tiers; Google Play Console has a one-time developer registration fee; Expo/EAS has free and paid build options.

## Data And Persistence Decisions

- Completed guest-room game history should be deleted after a retention period.
- Completed room history should remain for 15 days by default.
- Paid-user history should be stored beyond the default retention period.
- Anonymous players should have temporary device-saved IDs so they can rejoin.
- Room results should be shareable after a game ends.
- Reported answers should be saved for moderation review.

## Scale And Performance Decisions

- Private beta target: support 10 active rooms.
- Room player limit: 8 players.
- Spectator limit: 20 spectators per room for now.
- When the timer ends, auto-submit whatever is typed.
- If a player has poor internet, wait briefly before moving on.
- Product priority: balance fast gameplay with not leaving players behind.

## Security Decisions

- Room codes should be short but secure-readable, such as `A7KQ9Z`.
- Players cannot change display name after joining a room.
- Submitted answers are locked.
- UI should auto-submit when the timer ends and move to the next phase.
- Server must still reject late submissions after the timer to prevent hacked-client abuse.
- Room creation should be rate-limited.
- Free users: max 3 rooms per device/account per hour.
- Paid users: max 10 rooms per device/account per hour.

## Compliance And Data Protection Decisions

- Users should be able to request data deletion once accounts exist.
- Users should be able to export game history later.
- Minimum age target: 13+.
- Reported/offensive answers should be kept longer than normal game history for moderation evidence.
- Analytics should be anonymous by default.

## Observability Decisions

- Track basic anonymous events.
- Add crash/error reporting before private beta.
- Build a small admin dashboard later for rooms, reports, abuse strikes, and usage.
- Track where players drop off in the game flow.
- Beta errors should show a friendly message plus a report code.

## Testing And Quality Decisions

- Scoring rules should have automated tests before backend work continues.
- Room flow should have tests where practical.
- Manually test on Android phone before each major milestone.
- Weak internet and reconnect behavior should be tested before private beta.
- Minimum beta quality target: usable but rough.

## CI/CD And Shipping Decisions

- Every code change should pass typecheck and tests before being called done.
- Use one main branch for now.
- Database changes should use migration files, not manual dashboard edits.
- Create preview/test builds before giving APKs to testers.
- Keep a changelog for each beta build.

## Reliability And Operations Decisions

- If realtime disconnects mid-round, pause briefly.
- Recommended reconnect grace: 5-10 seconds for beta.
- If Supabase is down, show a friendly offline/error screen.
- Back up the database before public launch.
- Beta users should have a simple feedback/bug report path.
- If a release is broken, rollback quickly.

## Build Priority Decisions

- Next build order: scoring tests, then state cleanup, then Supabase rooms.
- Finish applying the Taste Skill/design audit to remaining screens before backend work deepens.
- Private beta should include real online multiplayer.
- Add a simple beta feedback form/screen inside the app.
- Create a concrete build roadmap to the private beta target date of 2026-07-05.

## MVP Features

### Rooms

- Create private room.
- Join private room by code.
- Join private room by invite link later.
- Join using display name and room code first.
- Room codes expire after 1 hour.
- Players can only join before the first round starts.
- Disconnected players can rejoin with the same name.
- Spectators are allowed.
- Show lobby participants.
- Game control should be shared between players where practical.
- Room code is short, readable, and shareable.

### Round Play

- Random letter per round.
- Configurable starter timer, default 90 seconds.
- Fixed number of rounds per session.
- Timed session structure.
- Starter categories:
  - Name
  - Place
  - Animal
  - Thing
- Submit answers before timer ends.
- Preserve blank answers as score 0.
- Answers that do not start with the selected letter should trigger a warning, not be blocked.
- Player answers stay hidden from other players until the reveal phase.

### Scoring

- Valid answer: 10 points.
- Duplicate answer: 5 points.
- Invalid answer: 0 points.
- Blank answer: 0 points.
- Accepted spelling/accent variants: half score.
- Repeated invalid-answer streak: -5 points after 3 in a row.
- MVP starts with player-based validation.
- Hybrid validation is planned later: player vote first, dictionary/API suggestions second, final decision by group/host.

### Leaderboard

- Show total score per player.
- Show round history.
- Show letter used per round.
- Show answered count and score per round.

## Future Features

- Supabase Realtime private rooms.
- User accounts or lightweight anonymous sessions.
- Majority voting.
- Host override.
- Category packs.
- Game settings.
- Share invite links.
- Reconnect support.
- Anti-cheat protections.
- Moderation/reporting.
- Push notifications.
- Monetisation through paid packs or ads.
- Optional cultural/theme packs.
- Better final app name.

## Platform And Cloud

- Mobile app: Expo + React Native + TypeScript.
- First platform: Android.
- First testing path: real Android phone with Expo Go.
- Backend target: Supabase managed cloud.
- Local prototype runs without backend.
- Native builds later through EAS Build.
- First installable beta can use a private APK/testing link before Google Play internal testing.

## Application Architecture

- Monorepo:
  - `apps/mobile`: Expo React Native app.
  - `packages/game-core`: pure game rules and scoring.
  - `packages/shared`: shared constants and types.
  - `docs`: product and engineering docs.
  - `supabase`: future migrations/functions.
- Game logic must stay out of screen components.
- Backend calls must not be mixed into scoring functions.
- Use event-shaped state for online play:
  - `player_joined`
  - `round_started`
  - `answer_submitted`
  - `vote_cast`
  - `round_scored`

## Data And Persistence

Planned Supabase tables:

- `rooms`
- `room_players`
- `rounds`
- `answers`
- `votes`
- `round_scores`
- `category_packs`
- `categories`
- `reports`

Every important table should include:

- Stable ID.
- `created_at`.
- `updated_at` where needed.
- Owner/room reference.
- RLS policy.

Data protection requirements:

- Use Supabase Row Level Security.
- Users can only access rooms they belong to.
- Room codes must not expose private data.
- Keep moderation/reporting possible from the start.
- Backups must be configured before public launch.
- Delete completed guest-room data after 15 days.
- Retain paid-user history beyond the guest retention window.
- Save reported answers for review.

## Scale And Performance

MVP scale target:

- Small private rooms.
- 2-8 players per room.
- Up to 20 spectators per room.
- 10 active rooms for private beta.
- Fast realtime updates during rounds.

Performance checks before launch:

- Round start latency.
- Answer submit latency.
- Vote sync latency.
- Leaderboard update speed.
- Reconnect behavior.
- Supabase realtime channel limits.

## Security

Key abuse cases:

- Guessing room codes.
- Joining rooms without permission.
- Submitting after timer ends.
- Voting multiple times.
- Editing answers after reveal.
- Sending offensive answers.
- Spamming room creation.
- Tampering with client-side score.
- Abuse reports and moderation action spam.

Security requirements:

- Server owns final room and score state once backend exists.
- Validate all client input.
- Never trust client-only timer state.
- Server rejects late submissions after timer end.
- Submitted answers are locked.
- Display name changes are blocked after joining.
- Store secrets only in environment variables.
- No service role key in mobile app.
- Rate-limit room creation and answer submission where possible.
- Room creation limit: 3/hour for free users, 10/hour for paid users.
- Use RLS and server-side checks for sensitive writes.
- Track abuse strikes in a rolling 5-day window.
- Support warning, timeout, room ban, and future account ban states.

## Payments

No payments in the first local MVP.

Future payment considerations:

- Paid category packs.
- Subscription to remove ads.
- Paid-user access to custom category creation.
- Google Play billing.
- Refund handling.
- VAT/tax rules.
- Purchase restore.
- Coupon/promo handling.
- Revenue reporting.

## Compliance And Data Protection

Likely compliance scope:

- GDPR.
- UK/EU data protection expectations.
- User deletion requests.
- Data export requests if accounts exist.
- Third-party subprocessors: Supabase, Expo/EAS, analytics provider, crash reporting provider.

Data minimisation:

- Do not collect unnecessary personal data.
- Start with display names, not full profiles.
- Avoid storing precise location.
- Add privacy policy before public release.
- Anonymous analytics by default.
- Support deletion and export once accounts exist.
- Keep reported/offensive answers longer for moderation evidence.

## Observability

Before beta:

- Client crash reporting.
- Basic event analytics.
- Error logging.
- Supabase dashboard monitoring.
- Uptime checks for backend endpoints.
- Friendly error messages with report codes.

Useful events:

- App opened.
- Room created.
- Player joined.
- Round started.
- Answer submitted.
- Vote cast.
- Round finished.
- Error occurred.

## Testing And Quality

Required before backend:

- Unit tests for scoring.
- Unit tests for letter generation.
- Unit tests for category defaults.
- Component sanity tests where useful.
- Room-flow tests where practical.

Required before public beta:

- Integration tests for room creation/join.
- Realtime sync tests.
- RLS policy tests.
- Manual Android device testing.
- Load smoke test for active rooms.
- Basic abuse testing.
- Weak internet/reconnect testing.

## CI/CD And Shipping

Planned:

- Git-based branching.
- Typecheck on every change.
- Tests on every change.
- Preview builds before release.
- Supabase migrations reviewed before deploy.
- EAS builds for Android.
- Staging environment before production.
- Changelog for each beta build.
- One main branch during early private-beta development.

## Reliability And Operations

Before beta:

- Backup plan for Supabase.
- Rollback plan for migrations.
- Graceful handling when realtime disconnects.
- Clear error states in app.
- Basic incident checklist.
- Beta feedback/bug-report path.

Potential uptime target:

- MVP private alpha: best effort.
- Public beta: 99% monthly target.

## Open Questions

See `docs/prd-questions.md`.
