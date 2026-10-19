# Live scoring audit — AF8E84

Playwright UI audit of round 1, letter G, Hikari and Teech. No source or backend changes. Not a complete multiplayer regression test.

## Reproduced
- Scoring screen simultaneously displayed server deadline Complete / This phase is complete on the server and Give all scores first. It continued exposing score controls.
- Review tab navigated successfully while Give all scores first remained blocked. App.tsx:1713 pending votes gate the footer at 6269, but tab handler at 5148 unconditionally switches steps.
- Teech's Glory displayed Unique after scoring, but review displayed 0 with valid checkmark. Review uses onlineAnswer.points and onlineAnswer.verdict separately (App.tsx:1910); exact backend cause not yet established.
- Own inline scores summed to 60 (five 10s and two 5s), while headline score was 70. Review self entries derive local verdict score (App.tsx:1896), while online entries read server fields. Conflicting score sources need tracing.
- Challenge my score on Gideon remained clickable; clicking produced no visible dispute, vote controls or explanation after follow-up observation. openSyncedAnswerDispute rejects expired scoring via roomError (useLocalGame.ts:2478); compact challenge handler has no expiry/phase guard (App.tsx:2196). Need network capture to establish exact rejection for this click.
- Compact dispute vote handler calls async persistSyncedDisputeVote without awaiting and immediately displays Vote submitted (App.tsx:2129/2153). Static confirmed false-success risk, not reproduced end-to-end in this expired round.
- Repeated Teech left notices interrupted inspection and name changed to Player. Cannot distinguish foreground/background disconnect, deliberate exit, and presence bug from this audit.

## Evidence
- /tmp/word-brawl-scoring-audit.png
- /tmp/word-brawl-challenge-audit.png
- Playwright REPL session 14117 holds live page, browser and errors array. No uncaught page errors at initial audit.

## Next
Capture network replies for vote/challenge; unify authoritative score and phase display; align tab/footer gating; await dispute write and present success only after confirmation; rerun two-client scoring/challenge/dispute flow in a fresh room. Current round expired during human discussion; do not treat late-action rejection itself as a bug.
