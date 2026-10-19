# Word Brawl Web Playtest Report

**Date/time:** 19 October 2026, 11:15–11:44 BST  
**Environment:** local development web preview at `http://127.0.0.1:8091/`  
**Browser:** Chromium via Playwright, headless, 1440×900 viewport  
**Player setup:** anonymous player; a second controlled browser page was used for Private Brawl  
**Scope:** UI-only playtest. No source, configuration, database schema, game rules or dependencies were changed.

## 1. Executive summary

The web preview loads and the main menu is understandable. Live Brawl can find CPU rivals and reach a scoring screen. Private Brawl supports room creation, valid joining, round start, answer submission, scoring setup and a confirmed close flow.

Two player-impacting problems were observed:

1. **Practice opens Private Brawl from the main menu.** This blocks the Practice mode through the normal player path.
2. **Live scoring showed the wrong round letter and zeroed correct-looking answers.** The round was played with letter L, but the scoring screen showed letter Z while displaying the submitted L answers at 0 points.

Practice could not be played because of the first defect. Live and Private Brawl did not reach a final match result in this pass; Live stopped at the inconsistent scoring state, and Private stopped at the scoring setup screen after confirming the journey worked that far.

## 2. Test coverage

| Mode | Scenario | Outcome |
|---|---|---|
| Reconnaissance | Open preview, inspect startup rules and menu | Completed |
| Live Brawl | Anonymous entry, matchmaking, CPU fill, round, submit, scoring | Completed to scoring; integrity issue observed |
| Practice | Select Practice and start a round | Blocked: opened Private Brawl instead |
| Private Sessions | Create room, inspect code/waiting state | Completed |
| Private Sessions | Invalid room code | Completed; clear error shown |
| Private Sessions | Controlled second-player join | Completed |
| Private Sessions | Host starts round; guest receives round | Completed after a short polling delay |
| Private Sessions | Both players submit; host opens scoring | Completed |
| Private Sessions | Close room through confirmation | Completed |

## 3. Most important findings

| ID | Mode | Finding | Severity | Confidence | Evidence |
|---|---|---|---|---|---|
| WB-01 | Practice | Main-menu Practice opens a Private Brawl lobby | High | Confirmed, 1 observed attempt | [03-main-menu](./03-main-menu.png), [05-practice-round](./05-practice-round.png) |
| WB-02 | Live Brawl | Scoring screen shows a different letter from the played round and gives submitted answers 0 points | High | Confirmed, 1 observed attempt | [15-live-before-answer](./15-live-before-answer.png), [17-live-score-review](./17-live-score-review.png) |
| WB-03 | Private Sessions | Guest lobby says it is waiting for the host for roughly 2–3 seconds after the host starts, then transitions normally | Low | Observed, 2 attempts | [25-private-guest-round](./25-private-guest-round.png), [26-private-guest-after-host-start](./26-private-guest-after-host-start.png) |

WB-03 is recorded as a usability observation, not a confirmed defect: the guest eventually reached the correct shared round and letter.

## 4. Detailed issue log

### WB-01 — Practice opens Private Brawl

**Mode:** Practice  
**Scenario:** Start a solo practice game from the anonymous main menu.  
**Starting state:** Main menu showed `Play Live Brawl`, `Practice`, and `Private Brawl`.  

**Actions taken:**

1. Selected `Start Playing`.
2. Selected `Play as Anonymous`.
3. Selected the visible `Practice` menu item.
4. Waited for the destination screen to load.

**Expected result:** A Practice setup screen with CPU, round and timer settings, followed by `Start Practice`.  
**Actual result:** The screen was headed `PRIVATE BRAWL` and showed `Session`, `Invite players`, `Session code`, `Create New Brawl`, and a private-room waiting state.  
**Player impact:** A player cannot reach the advertised Practice mode through the normal menu and may think they have accidentally created or entered a multiplayer room.  
**Reproduction rate:** Once observed in this pass. The same path had also produced the same destination earlier in the run.  
**Evidence:** [03-main-menu](./03-main-menu.png) shows the menu; [05-practice-round](./05-practice-round.png) shows the resulting Private Brawl state. Approx. 11:35 BST.  
**Classification:** Confirmed bug.  
**Severity:** High.  
**Suggested improvement:** Correct the Practice menu action so it opens the Practice setup screen; add a simple automated smoke check that each main-menu mode opens its own heading.

### WB-02 — Live scoring uses the wrong letter and zeroes submitted answers

**Mode:** Live Brawl  
**Scenario:** Play one public live round against CPU rivals and score the submitted answers.  
**Starting state:** Live Brawl found CPU rivals and entered Round 1. The round screen displayed letter `L` and stated that every answer must start with L.  

**Actions taken:**

1. Entered `Liam`, `London`, `Lion`, and `Lamp` in Name, Place, Animal and Object.
2. Selected `Submit Answers`.
3. Observed `WORDS LOCKED` and `ROUND SUBMITTED`.
4. Selected `Score the Round`.

**Expected result:** The scoring screen should preserve the same round letter and score answers against the visible L rule.  
**Actual result:** The scoring screen displayed `Letter Z` while showing the submitted L answers (`Liam`, `London`, `Lion`, `Lamp`). Each of the player answers was shown at `0 pts`; the screen still described the round as Round 1.  
**Player impact:** This undermines trust in scoring and can incorrectly remove points from a player who followed the displayed rule. It also makes the result impossible to explain from the UI alone.  
**Reproduction rate:** Once observed in this pass; requires a repeat against a clean room before release decision.  
**Evidence:** [15-live-before-answer](./15-live-before-answer.png) captures the L round; [16-live-submitted](./16-live-submitted.png) captures the locked submission; [17-live-score-review](./17-live-score-review.png) captures the Z scoring screen and zero scores. Approx. 11:39 BST.  
**Classification:** Confirmed bug.  
**Severity:** High.  
**Suggested improvement:** Bind the scoring/reveal view to the submitted round ID and display the server-authoritative letter for that same round. Add a player-facing guard that refuses to score if the displayed round letter and answer round do not match.

### WB-03 — Guest briefly shows a stale waiting state after host starts

**Mode:** Private Sessions  
**Scenario:** Join a private room with a controlled second browser page and observe the guest when the host starts Round 1.  
**Starting state:** Both clients showed 2/2 players ready.  

**Actions taken:**

1. Host selected `Start Round`.
2. Guest was observed at approximately 1.2-second intervals.

**Expected result:** The guest should transition promptly to the active round or show a clear loading state.  
**Actual result:** The guest continued to display the lobby and `Waiting for Anonymous112` for roughly 2–3 seconds, then transitioned to the active round with the same letter and categories as the host.  
**Player impact:** A guest may think the host did not start or that the room is stuck, especially with a live countdown.  
**Reproduction rate:** Observed in 2 controlled joins; the transition eventually completed both times.  
**Evidence:** [25-private-guest-round](./25-private-guest-round.png) shows the active host round while the guest remained in lobby; [26-private-guest-after-host-start](./26-private-guest-after-host-start.png) shows the guest after it caught up. Approx. 11:41 BST.  
**Classification:** Usability issue / improvement suggestion.  
**Severity:** Low.  
**Suggested improvement:** Show `Starting round…` while the guest polls, and include a visible last-updated or connection state so the waiting text is not mistaken for a failed start.

## 5. Mode-by-mode feedback

### Live Brawl

- Matchmaking is understandable: the UI explains that it searches briefly for real players and then fills empty seats with CPU rivals.
- CPU rivals appeared in the roster and the round started without requiring a second human account.
- The answer screen clearly showed the letter, category order, answer count, timer, `Submit Answers` and `Quit Game`.
- Submission feedback was clear: `WORDS LOCKED` and `ROUND SUBMITTED` appeared.
- Scoring could be reached, but the letter mismatch and zero scores prevent this from being considered a reliable completed round.
- No final result, rematch or reconnect flow was assessed after the scoring inconsistency.

### Practice

- The Practice setup was not reachable from the main menu because its action opened Private Brawl.
- A genuine Practice round, CPU scoring, duplicate answers and Practice exit/re-entry remain untested.

### Private Sessions

- Room creation displayed a six-character session code, expiry time, host status, player count, settings and a clear `Close Session` control.
- Invalid code `AAAAAA` produced `Room not found or expired.` and returned the user to the join form.
- A controlled guest joined successfully and both clients showed consistent membership and settings.
- The host could start a round once two players were present.
- Both clients received the same round letter and categories after the guest’s short synchronization delay.
- Both players submitted answers and the host reached the manual scoring screen with all seven categories pending.
- `Close Session` opened a confirmation modal explaining that other players may keep the brawl available; confirming returned to the main menu.

## 6. Positive observations

- The startup quick rules explain the core loop and the visible scoring values: valid 10, shared/duplicate 5, invalid 0.
- The main menu labels the three game modes in plain language.
- Waiting and room screens expose useful state: expiry, seat count, player list, categories and settings.
- The private-room invalid-code message is short and actionable.
- The private close confirmation distinguishes closing on the current device from the room possibly remaining available to other players.
- The active round controls are easy to identify at the tested desktop viewport.

## 7. Blocked and untested scenarios

- Practice gameplay, CPU validation and Practice scoring were blocked by WB-01.
- Live final result, dispute/vote flow, rematch and leave/reconnect after scoring were not completed because WB-02 produced an inconsistent scoring state.
- Private dispute/vote behaviour, refresh recovery and temporary connection interruption were not tested.
- No cross-browser, mobile viewport, keyboard-only, screen-reader or broad accessibility coverage is claimed.
- No production or hosted environment was tested. The target was loopback-only local development.

## 8. Recommended next actions

1. Fix and smoke-test the main-menu Practice action. This is the shortest path to restoring an advertised mode.
2. Investigate Live round identity/state used by reveal and scoring. Re-run with a fresh room and assert that the displayed letter, submitted answers, verdicts and points all reference the same round.
3. Add an explicit guest `Starting round…` state during synchronization.
4. After WB-02 is fixed, repeat full Live scoring, dispute/vote, final result and replay coverage.
5. After WB-01 is fixed, run a complete Practice round with valid, invalid, blank, duplicate and category-specific answers.

## Evidence index

All screenshots in this report were captured during the 19 October 2026 run from the local web preview. Session codes and anonymous names shown in screenshots were disposable test data; they are not production credentials or real-player data.

