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

- `apps/mobile/App.tsx` is about 10,735 lines and contains screens, theme constants, assets, game presentation, and many handlers together.
- `apps/mobile/src/useLocalGame.ts` is about 2,863 lines and mixes local state, persistence, and online-room orchestration.
- `apps/mobile/src/onlineRooms.ts` is about 1,983 lines and contains the Supabase room and authoritative-result adapter.
- Pure review projections now live in `apps/mobile/src/reviewPresentation.ts`.
- Pure local CPU round generation, duplicate handling and scoring now live in `apps/mobile/src/localBotRound.ts`.
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
    hooks/
      useLocalGame.ts
      useGameAudio.ts
    services/
      onlineRooms.ts
      wordBank.ts
    localBotRound.ts              # CPU answer generation and local scoring
    reviewPresentation.ts         # pure review data projections
```

Do not create all folders at once. Create a folder only when moving the first file into it.

## Safe change order

1. Preserve a working baseline with typecheck and tests.
2. Extract theme tokens and artwork references first; change no behaviour.
3. Extract reusable components from the home screen.
4. Extract one screen at a time, starting with Home, then Lobby, Round, Reveal, Scoring, and Leaderboard.
5. Rename `useLocalGame.ts` only after any further extracted boundaries compile.
6. Remove confirmed-unused assets and generated files only after reference checks.
7. Run typecheck, tests, and a manual Android smoke test after each extraction.

## Cleanup rules

- Delete only files proven unused by imports, config, or build references.
- Treat `android/build`, `android/.gradle`, and `.expo` as generated caches; they can be regenerated.
- Keep original design assets until the UI refactor is complete.
- Do not delete `tmp/` design screenshots until the chosen visual direction is final.
- Never put scoring or room-state rules inside screen components.
