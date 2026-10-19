# Beta verification checklist

## Scoring

- [ ] Run isolated local Supabase migration tests.
- [ ] Verify variant answers receive shared points (5) under default rules.
- [ ] Verify legacy variant scoring override remains effective.

## Gameplay

- [ ] Open Practice from the main menu and complete all rounds.
- [ ] Play Live Brawl and verify the letter is identical on round, reveal and scoring screens.
- [ ] Confirm submitted answers, round ID, verdicts and persisted points match.
- [ ] Complete a Private Match with two clients, including voting and reconnect.
- [ ] Replay after a finished match and verify no old state remains.

## Release

- [ ] Run TypeScript and unit tests on the review branch.
- [ ] Run browser regression tests and an Android device smoke test.
- [ ] Verify release metadata and native build before beta approval.

Source: docs/audits/2026-10-19-web-playtest/report.md.
