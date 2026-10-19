# Live Brawl Five-Game Bug Hunt

**Date:** 19 October 2026
**Scope:** Live Brawl only
**Result:** WB-LB-01 fixed and verified. **5 of 5 games completed through final results.**

## Environment and setup

- Repository: `/home/hikari/.openclaw/workspace/animal-name-place`
- Required preview: `http://127.0.0.1:8091/`
- Browser setup: Playwright shared install at `/home/hikari/.openclaw/workspace/career-ops/node_modules/playwright`
- Existing dedicated Playwright scripts: none found in the repository
- Existing local monitor notes and prior screenshots were inspected
- WB-LB-01 fix changed only the dispute-modal animation in `apps/mobile/App.tsx`; one focused regression assertion was added in `apps/mobile/src/reviewInterface.test.tsx`
- No credentials or production data were used
- Preview recovery command: `corepack pnpm --filter mobile exec expo start --web --port 8091`

The existing baseline report and screenshots 15–17 were inspected before attempting gameplay. The screenshots show a prior mismatch: screenshot 15 displays letter `C`, screenshot 16 displays submitted round letter `L`, and screenshot 17 displays scoring letter `Z`. The baseline report text describes that same run as letter `L`; the screenshots are treated as the stronger direct evidence.

## Preview recovery and safety check

The required preview was not running during this pass:

```text
curl http://127.0.0.1:8091/
curl: (7) Failed to connect to 127.0.0.1 port 8091
```

Ports 8780 and 8787 were reachable, but their titles were `Dashboard Hub` and `Budget Dashboard`; neither is the Word Brawl preview. A local Word Brawl export exists under `.local-monitor/tmp/release-web-export/`, but it has no active listener and was not treated as a current preview. The preview was not restarted, rebuilt, reconfigured, or replaced.

The preview was started only after confirming that 8091 had no listener and no Expo/Metro app process existed. The documented package command is `expo start --web`; the command above invokes that existing command directly with the established 8091 port and avoids the package pre-hook that refreshes generated metadata.

Recovery evidence:

- Process: Expo wrapper PID 18458 and Metro/Expo CLI PID 18495 remained alive under the scoped start command.
- Port: `127.0.0.1:8091` began listening.
- HTTP: `GET /` returned `200 OK` with the Word Brawl HTML shell.
- Browser: Playwright loaded title `Word Brawl` and reached the real `QUICK RULES` UI and Live Brawl matchmaking.
- Screenshot: [preview-recovery-current.png](./live-brawl-five-game-evidence/preview-recovery-current.png)
- Browser verification reported no page exceptions or failed requests.
- Known non-blocking startup output: optional React Native DevTools launch failed; the Expo/Metro preview continued normally.

## Fix and verification

The confirmed defect was the CPU dispute notice modal using a `slide` presentation. Its fixed backdrop remained a real hit-test blocker while the modal content could be visually displaced below the viewport. The smallest targeted fix was to change that modal to `animationType="fade"` in [App.tsx](../../../../apps/mobile/App.tsx). The dispute notice, backdrop, `Review Vote` action, and dismissal lifecycle remain intact.

Regression coverage was added in [reviewInterface.test.tsx](../../../../apps/mobile/src/reviewInterface.test.tsx), asserting that the CPU dispute modal wiring uses the stable animation, remains explicitly dismissible, and retains `Review Vote`.

Verification commands and results:

```text
corepack pnpm --filter mobile exec vitest run src/scoringReadiness.test.ts src/reviewInterface.test.tsx --no-cache
2 files passed, 35 tests passed

corepack pnpm --filter mobile exec tsc --noEmit
passed
```

A Playwright browser proof used normal UI clicks through help dismissal, scoring review, `Review Vote` where shown, and `Finish Round`. It reached the app's `LEADERBOARD` / `SESSION RESULT` state without force-clicking or DOM changes. Evidence: [post-fix-finish-observed.png](./live-brawl-five-game-evidence/post-fix-finish-observed.png), [wb-lb-01-fixed-review.png](./live-brawl-five-game-evidence/wb-lb-01-fixed-review.png), and [wb-lb-01-fixed-after-finish.png](./live-brawl-five-game-evidence/wb-lb-01-fixed-after-finish.png). The browser proof recorded no page exceptions or failed requests.

## Game summary

| Game | Test ID | Completed | Blocker | Round/room identifiers | Evidence |
|---|---|---:|---|---|---|
| 1 | LBF-20261019-G1 | Yes | — | Room `980071ff-cfe8-44bf-ac50-b77488f34a0b`; R1 `177226bd-4303-4765-b566-e654d200216e`; letters I / U / M; totals 20 / 20 / 20 | [game1-final.png](./live-brawl-five-game-evidence/game1-final.png) |
| 2 | LBF-20261019-G2 | Yes | — | Room `1c6c1a78-4299-431a-9c04-9da0bebe6cbc`; letters B / Y / J; totals 30 / 20 / 20 | [game2-final.png](./live-brawl-five-game-evidence/game2-final.png) |
| 3 | LBF-20261019-G3 | Yes | — | Room `2c9124f4-9fbd-46f8-b608-e71c16195fd0`; R1 `703e3a09-777c-4d24-bb75-60058f6d52ae`; letters V / O / J; totals 40 / 10 / 20 | [game3-final.png](./live-brawl-five-game-evidence/game3-final.png) |
| 4 | LBF-20261019-G4 | Yes | — | Room `f2817e60-5c7a-4ed1-8054-e872b34ca9b8`; letters B / O / F; totals 30 / 10 / 10 | [game4-final.png](./live-brawl-five-game-evidence/game4-final.png) |
| 5 | LBF-20261019-G5 | Yes | — | Room `e70d8f6b-b2de-45a5-b649-eb56fafe2f2d`; R1 `1741a4b0-e5e3-4a63-8621-7f927a93d13f`; letters L / Z / A; totals 30 / 10 / 10 | [game5-final.png](./live-brawl-five-game-evidence/game5-final.png) |

## Per-game verification

All five games used fresh anonymous browser contexts and reached the normal final `LEADERBOARD` / `SESSION RESULT` state. All 15 rounds reached scoring and final-result progression. The corrected Playwright runner recorded no page exceptions or failed requests.

Dynamic submissions, recorded from the normal UI, were:

- G1: I — `Ian`, `Ibadan`, `Ibis`, `Ink`; U — `Uma`, `123`, `Urchin`, duplicate `Urchin`; M — `Maya`, blank, `Nope`, `Mug`.
- G2: B — `Bob`, `Berlin`, `Bear`, `Book`; Y — `Yara`, `123`, `Yak`, duplicate `Yak`; J — `James`, blank, `Nope`, `Jacket`.
- G3: V — `Victor`, `Vienna`, `Vulture`, `Vase`; O — `Olivia`, `123`, `Owl`, duplicate `Owl`; J — `James`, blank, `Nope`, `Jacket`.
- G4: B — `Bob`, `Berlin`, `Bear`, `Book`; O — `Olivia`, `123`, `Owl`, duplicate `Owl`; F — `Fiona`, blank, `Nope`, `Fork`.
- G5: L — `Liam`, `London`, `Lion`, `Lamp`; Z — `Zoe`, `123`, `Zebra`, duplicate `Zebra`; A — `Alice`, blank, `Nope`, `Apple`.

The scoring screenshots show the displayed round letter, answer rows, verdict labels and point values. Representative visible rows include valid 10-point answers, shared/duplicate 5-point answers, invalid/blank 0-point answers, and pending player-review rows. The displayed round totals are recorded in the summary table and remained consistent with the scoring screens; no letter mismatch or incorrect total was observed in these five runs. Some category sections were collapsed in the captured UI, so this report does not claim a machine-extracted per-category point sum for every collapsed section.

The previous exact-text `LEADERBOARD` locator produced false timeouts because React Native Web split the heading across DOM nodes. The corrected run used the authoritative body-state transition (`LEADERBOARD`) and normal UI controls. That was a test-harness issue, not a product failure.

## Findings

### Confirmed bugs in the original run

#### WB-LB-01 — CPU dispute notice overlay blocks the visible scoring controls

- **Severity:** High; blocks normal round completion and therefore the match result
- **Reproduction:** Enter Live Brawl anonymously, submit a round, select `Score the Round`, dismiss `How scoring works` with `Got it — start scoring`, select `Review Scores`, then select the visible `Finish Round` control before acknowledging the dispute notice.
- **Expected:** The visible control accepts the click and advances to the next round or final result.
- **Actual:** The help modal is dismissed correctly. Entering Review asynchronously creates a separate `Words disputed` CPU notice modal. Its fixed backdrop captures the `Finish Round` hit-test even though the underlying button remains visible and labelled `Finish Round`. In some timing/scroll states the modal content is below the viewport, making the blocker appear invisible; normal clicking times out and the screen remains on scoring.
- **Reproduction:** Observed in two fresh browser attempts during this resumed audit.
- **Evidence:** [game1-round1-scoring.png](./live-brawl-five-game-evidence/game1-round1-scoring.png) shows the underlying scoring UI. DOM inspection found a fixed `aria-modal="true"` wrapper with `z-index: 0`, a fixed animation wrapper with `z-index: 9999`, `pointer-events: auto`, and text `Words disputed`; `document.elementsFromPoint()` at the visible Finish Round center returned that wrapper before the button. After a normal `Review Vote` click, the fixed overlay count became zero.
- **Classification:** Confirmed original-run product defect. Fixed and verified in this pass; it was not reproduced after the targeted change.

### WB-LB-01 diagnosis

The relevant implementation is in [App.tsx](../../../../apps/mobile/App.tsx):

- `dismissScoringHelp()` at lines 964–970 sets `showScoringHelp(false)`. The scoring-help `Modal` at lines 6973–7018 is therefore not the stale overlay.
- The effect at lines 1577–1621 runs when `screen === 'scoring'` and `scoringStep === 'review'`. It calls `getCpuDisputeSuggestion()` for bot answers, stores the suggestions, and sets `activeDisputeNotice` when a challenge exists.
- `getCpuDisputeSuggestion()` at lines 1239–1285 generates suggestions for duplicate answers, wrong categories/letters, uncached words, and questionable short or malformed answers.
- The second `Modal` at lines 7019–7072 is visible when `screen === 'scoring' && Boolean(activeDisputeNotice) && !showScoringHelp`. It renders `Words disputed` and `Review Vote`.
- The notice is dismissed by `setActiveDisputeNotice(null)` at lines 7061–7068. A fresh DOM check after that normal click found no remaining fixed interactive overlay.

This is not a Playwright-only hit-test artefact. The browser DOM has a real fixed modal/backdrop with `pointer-events: auto` and `aria-modal="true"`, and it correctly blocks controls beneath it. It is a product/UI defect because the underlying `Finish Round` action remains visibly available while the notice modal is active, and the `slide` modal can be visually offscreen during the blocking state. The normal player is not given a reliable visible explanation at the point where Finish is blocked.

The overlay does block other controls underneath its covered area, as a modal should. It does not persist after `Review Vote`; the fixed overlay count returned to zero. The defect is the misleading/partially invisible blocking state, not a stale help-modal lifecycle.

### Applied fix

The applied fix changes the dispute notice presentation from `slide` to `fade`. This keeps legitimate dispute review and voting behaviour intact while preventing the content/backdrop positioning race that made a real modal blocker appear invisible. The focused regression test preserves the modal's explicit dismissal and `Review Vote` wiring. Browser verification confirmed that normal `Finish Round` remains usable after the review flow.

### Prior evidence requiring re-verification

The baseline evidence reviewed before this run contains a high-severity candidate: Live scoring displayed inconsistent letters across screenshots 15–17 and zeroed submitted answers. This was **not reproduced in the five complete games**: the current runs preserved the displayed round letters through scoring and showed the recorded totals. No new letter/score mismatch was confirmed.

Evidence reviewed:

- [15-live-before-answer.png](../15-live-before-answer.png)
- [16-live-submitted.png](../16-live-submitted.png)
- [17-live-score-review.png](../17-live-score-review.png)

### Suspected bugs

None newly identified in the five completed Live Brawl games. The prior report's Practice and Private Brawl findings were outside this task's Live Brawl-only scope and were not investigated.

### Usability suggestions

No new Live Brawl usability issue was raised. The scoring-help dismissal and dispute-review flow were verified through normal UI interaction.

## Evidence directory

`docs/audits/2026-10-19-web-playtest/live-brawl-five-game-evidence/` contains preview recovery, fix-verification, round-start, submission, scoring, and final-result screenshots for all five games. The baseline screenshots remain unchanged in the parent evidence directory.

## Recommended next action

Review and approve the WB-LB-01 patch. No further product fix was made for the prior letter/score mismatch because it was not reproduced in these five complete Live Brawl runs. A broader test-suite run can follow if desired; no new bug should be fixed without approval.
