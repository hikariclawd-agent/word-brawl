# Word Brawl: game processes and refactor plan

## Current player flow

```text
boot
  -> rules (first run only)
  -> nameSetup
  -> home
      -> modeDetail
      -> join
      -> globalLeaderboard
      -> settings / themes / about
  -> lobby
  -> round
  -> reveal
  -> scoring
  -> leaderboard
      -> next round -> lobby/round
      -> finish -> home
```

## What each process does

1. **Boot and setup**
   - Load saved player name, profile, rules-seen flag, and cached word bank.
   - Show rules only when required, then collect the display name.

2. **Mode selection**
   - Choose Classic, Practice, Marathon, or Custom.
   - Store categories, timer, round count, scoring style, and CPU settings.

3. **Room process**
   - Create or join a local/private room, or find a live table.
   - The lobby owns room settings, player list, host/letter-picker state, and start readiness.

4. **Round process**
   - Select a shared letter.
   - Start the countdown.
   - Save draft answers while the player types.
   - Auto-submit at timeout or submit manually.
   - Online rooms sync drafts/submissions through `onlineRooms.ts`.

5. **Reveal process**
   - Reveal answers after submission.
   - Show answer metadata and fact-check/dispute actions.
   - Keep other players' answers hidden until this phase.

6. **Scoring process**
   - Apply valid, variant, duplicate, invalid, and blank verdicts.
   - Local games use CPU/opponent simulation; online games persist votes/verdicts.
   - Resolve disputes, calculate the round total, and complete the round.

7. **Leaderboard process**
   - Update round history, player totals, streaks, achievements, and match result.
   - Offer the next round, rematch, room exit, or global leaderboard.

## Current architecture problems

- `apps/mobile/App.tsx` is about 9,300 lines and contains screens, theme constants, assets, game presentation, and many handlers together.
- `apps/mobile/src/useLocalGame.ts` is about 2,500 lines and mixes local state, bot simulation, persistence, and online-room orchestration.
- Styles are in one `StyleSheet.create` block at the bottom of `App.tsx`.
- Runtime assets and design-review screenshots are mixed across `assets/` and `tmp/`.

## Target folder structure

```text
apps/mobile/
  App.tsx                         # composition and screen routing only
  src/
    screens/                      # one file per major screen
      BootScreen.tsx
      HomeScreen.tsx
      LobbyScreen.tsx
      RoundScreen.tsx
      RevealScreen.tsx
      ScoringScreen.tsx
      LeaderboardScreen.tsx
    components/                   # reusable visual pieces
      BrandHeader.tsx
      PrimaryButton.tsx
      GameCard.tsx
      PlayerRow.tsx
      TimerBadge.tsx
      CategoryAnswerInput.tsx
    theme/
      tokens.ts                   # colors, spacing, radii, typography
      styles.ts                   # shared style helpers
    data/
      gameModes.ts
      botLibrary.ts
      artwork.ts
    game/
      localGameState.ts           # local-only state and transitions
      botSimulation.ts            # CPU answer generation and behaviour
    hooks/
      useLocalGame.ts
      useGameAudio.ts
    services/
      onlineRooms.ts
      wordBank.ts
```

Do not create all folders at once. Create a folder only when moving the first file into it.

## Safe change order

1. Preserve a working baseline with typecheck and tests.
2. Extract theme tokens and artwork references first; change no behaviour.
3. Extract reusable components from the home screen.
4. Extract one screen at a time, starting with Home, then Lobby, Round, Reveal, Scoring, and Leaderboard.
5. Move bot data/simulation out of `useLocalGame.ts`.
6. Rename `useLocalGame.ts` only after the extracted boundaries compile.
7. Remove confirmed-unused assets and generated files only after reference checks.
8. Run typecheck, tests, and a manual Android smoke test after each extraction.

## Cleanup rules

- Delete only files proven unused by imports, config, or build references.
- Treat `android/build`, `android/.gradle`, and `.expo` as generated caches; they can be regenerated.
- Keep original design assets until the UI refactor is complete.
- Do not delete `tmp/` design screenshots until the chosen visual direction is final.
- Never put scoring or room-state rules inside screen components.
