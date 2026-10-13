# PRD Questions

Answer these in batches. Do not try to solve every detail at once.

## Batch 1: Product Shape

Status: answered 2026-06-27.

1. Is the game mainly for friends/family, schools, party groups, or online strangers?
   - Friends and online strangers.
2. Should the first public version require accounts, or should players join with only a display name?
   - Display name and room code first.
3. What is the ideal room size: 2-4, 2-8, or more?
   - 2-8.
4. Should each game have a fixed number of rounds, or should players keep starting new rounds until they stop?
   - Fixed rounds, with each session timed.
5. Should the host control the whole game, or should control be shared?
   - Shared between players.

## Batch 2: Rules

Status: answered 2026-06-27.

1. What exact starter categories should MVP include?
   - Keep Name, Place, Animal, Thing.
2. Should players be forced to enter answers starting with the selected letter, or only warned?
   - Warn only.
3. Should accents/spelling variants count as valid?
   - Valid, but half score.
4. Should duplicate detection be exact text only, or smart enough to catch small spelling differences?
   - Duplicate answers should not receive full score. Exact vs close-spelling detection still needs implementation detail.
5. Should players see other answers before voting, or only during reveal?
   - Only during reveal.

## Batch 3: Validation And Scoring

Status: answered 2026-06-27.

1. For MVP, who decides validity: all players, host, majority vote, or self-marking?
   - Other players validate, but the answer owner can dispute.
2. If players disagree, what wins?
   - Majority. User suggested answer owner/main player could have two votes; recommendation is one vote per player for fairness and abuse resistance.
3. Should duplicate answers always get 5 points, or 0 points?
   - 5 points. Full mark is 10.
4. Should a player lose points for invalid answers?
   - Invalid is 0 points. Add -5 penalty if a player gets 3 invalid answers in a row.
5. Should the app block voting for your own answer?
   - No. Players can vote on their own answer.

## Batch 4: Online Rooms

Status: answered 2026-06-27.

1. Should room codes expire?
   - Yes, after 1 hour.
2. Can players join mid-game?
   - No. Only before the first round starts.
3. Can a disconnected player rejoin?
   - Yes, with the same name.
4. Should rooms be private by code only, or invite-link based?
   - Both room code and invite links.
5. Should there be a spectator mode?
   - Yes.

## Batch 5: Safety And Moderation

Status: answered 2026-06-27.

1. Should answers be reportable?
   - Yes.
2. Should offensive words be filtered?
   - Yes, the option should be there.
3. Should hosts be able to kick players?
   - Yes. Players should also be able to report/kick where appropriate.
4. Should players be able to block others?
   - Need later decision. Host/moderator role confirmed.
5. What minimum safety features are required before public launch?
   - Rolling 5-day abuse window: first 5 events warn, next 5 escalating timeouts, next 5 temporary room ban, then account ban later if abuse continues. Resets after 5 days.

## Batch 6: Monetisation

Status: answered 2026-06-27.

1. Should the app be free at launch?
   - Yes.
2. Which monetisation sounds best later: ads, paid category packs, subscription, or one-time premium?
   - Ads, plus subscription to remove ads.
3. Which themed packs should come first?
   - Simple abstract design first. Themed pack order still needs a later decision.
4. Should users be able to create custom categories?
   - Yes, for paid users.
5. Should custom packs be private or shareable?
   - Both, depending on the players.

## Batch 7: Brand And Design

Status: answered 2026-06-27.

1. What is the product name?
   - Word Brawl.
2. Should the app feel more calm/premium, competitive, funny, or cultural?
   - Simple and abstract for now.
3. What apps should it visually feel close to?
   - Unknown. Use design-system thinking from `nextlevelbuilder/ui-ux-pro-max-skill` as inspiration.
4. What apps should it definitely not feel like?
   - Unknown. Avoid generic/overdone styles until references are chosen.
5. Should the African-themed angle be core brand or optional packs?
   - Optional theme packs.

## Batch 8: Launch

Status: answered 2026-06-27.

1. Who are the first 5-10 testers?
   - To be found/recruited.
2. What counts as a successful beta?
   - Testers understand the game flow and successfully finish rounds.
3. Which country/region is first launch for?
   - UK and Nigeria.
4. Do we need iOS before public launch?
   - No. Android first.
5. What date should the private beta aim for?
   - End of next week from 2026-06-27, interpreted as Sunday 2026-07-05.

## Batch 9: Platform And Cloud

Status: answered 2026-06-27.

1. Backend choice: Supabase or compare Firebase/other options?
   - Supabase.
2. For private beta, one environment only or staging + production?
   - One beta environment now; staging + production before public launch.
3. Should users play as anonymous guests first, then accounts later?
   - Anonymous guests with display name first; accounts later.
4. Should we use EAS Build for Android builds when leaving Expo Go?
   - Yes.
5. First release path: private APK/testing link or Google Play internal testing?
   - Private APK/testing link first; Google Play internal testing later.

## Batch 10: Data And Persistence

Status: answered 2026-06-27.

1. Should we store game history after a room ends, or delete it after a time?
   - Delete guest history after a time; store paid-user history.
2. Should anonymous players have temporary IDs saved on their device so they can rejoin?
   - Yes.
3. Should room results be shareable after the game ends?
   - Yes.
4. Should reported answers be saved for moderation review?
   - Yes.
5. How long should completed rooms stay in the database?
   - 15 days by default.

## Batch 11: Scale And Performance

Status: answered 2026-06-27.

1. For private beta, how many active rooms should we design for?
   - 10 active rooms.
2. Max players per room is 8. Should spectators have a limit too?
   - 8 players; 20 spectators for now.
3. When the timer ends, should the app auto-submit whatever is typed?
   - Yes.
4. If someone has poor internet, should the game wait for them briefly, or move on immediately?
   - Wait briefly.
5. What matters more: fast gameplay, or making sure no player gets left behind?
   - A mixture of both.

## Batch 12: Security

Status: answered 2026-06-27.

1. Should room codes be easy like `ABCD12`, or more secure like `A7KQ9Z`?
   - Interpreted as short but secure-readable codes like `A7KQ9Z`.
2. Should players be allowed to change their display name after joining a room?
   - No.
3. Should answers become locked when submitted, or can players edit until the timer ends?
   - Locked when submitted.
4. Should the server reject late submissions after the timer, even if the phone tries to send one?
   - UI auto-submits and opens the next phase; server should still reject late submissions for security.
5. Should room creation be rate-limited?
   - Yes. 3/hour for free users, 10/hour for paid users.

## Batch 13: Compliance And Data Protection

Status: answered 2026-06-27.

1. Should users be able to request delete my data once accounts exist?
   - Yes.
2. Should users be able to export their game history later?
   - Yes.
3. Minimum age: 13+, 16+, or no public age gate for beta?
   - 13+.
4. Should reported/offensive answers be kept longer than normal game history for moderation evidence?
   - Yes.
5. Should analytics be anonymous by default?
   - Yes.

## Batch 14: Observability

Status: answered 2026-06-27.

1. Should we track basic anonymous events?
   - Yes.
2. Should we add crash/error reporting before private beta?
   - Yes.
3. Do you want a small admin dashboard later for rooms, reports, abuse strikes, and usage?
   - Yes.
4. Should we track where players drop off in the game flow?
   - Yes.
5. For beta, should errors show a friendly message plus a report code?
   - Yes.

## Batch 15: Testing And Quality

Status: answered 2026-06-27.

1. Should scoring rules have automated tests before we continue backend work?
   - Yes by recommendation. Automated tests are code checks for scoring rules without opening the app.
2. Should room flow have tests too?
   - Yes, where practical.
3. Should we manually test on your Android phone before each major milestone?
   - Yes.
4. Should we test weak internet/reconnect before private beta?
   - Yes.
5. What is the minimum acceptable beta quality?
   - Usable but rough.

## Batch 16: CI/CD And Shipping

Status: answered 2026-06-27.

1. Should every code change run typecheck + tests before we call it done?
   - Yes.
2. Should we keep one main branch for now, or use feature branches?
   - One main branch for now.
3. Should database changes require migration files only, no manual dashboard edits?
   - Yes by recommendation. Migration files keep DB changes reviewable and repeatable.
4. Should we create preview/test builds before giving APKs to testers?
   - Yes.
5. Should we keep a changelog for each beta build?
   - Yes.

## Batch 17: Reliability And Operations

Status: answered 2026-06-27.

1. If realtime disconnects mid-round, should the app pause briefly or keep going?
   - Pause briefly. Recommendation: 5-10 second reconnect grace for beta.
2. If Supabase is down, should the app show a friendly offline/error screen?
   - Yes.
3. Should we back up the database before public launch?
   - Yes.
4. Should beta users have a simple way to send feedback/bug reports?
   - Yes.
5. If a release is broken, should we rollback quickly or push a hotfix?
   - Rollback quickly.

## Batch 18: Build Priority Before Beta

Status: answered 2026-06-27.

1. Should the next build step be scoring tests, state cleanup, or Supabase rooms?
   - Recommendation accepted: scoring tests first, then state cleanup, then Supabase rooms.
2. Should we finish applying the Taste Skill to the remaining screens before backend?
   - Yes.
3. Should private beta include real online multiplayer, or is local prototype + APK enough for first testers?
   - Real online multiplayer.
4. Should we create a simple beta feedback form/screen inside the app?
   - Yes.
5. Should I turn the PRD into a concrete build roadmap with milestones from now to Sunday 2026-07-05?
   - Yes.
