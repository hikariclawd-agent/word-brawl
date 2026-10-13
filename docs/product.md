# Product

## MVP

Players can play complete Live Table and Private Table game rounds on Android.

## Starter Flow

1. Player opens app.
2. Player joins a Live Table or creates/joins a Private Table.
3. Live Tables auto-start after countdown; Private Table host starts a round.
4. App picks a random letter.
5. Players enter answers for each category.
6. Answers are revealed.
7. Players vote valid or invalid.
8. Scores are calculated.
9. Leaderboard is shown.

## Current Build Slice

Implemented locally:

- Home screen
- Home screen now works as a mode hub with top points/streak stats, mode cards, and a general leaderboard section
- Home uses a tappable icon-only Word Brawl brand mark, a visual player identity card, and a persistent avatar picker
- Display name editing lives in Settings, not on Home
- Home avatar picker stays hidden until the player taps the avatar icon
- Settings includes avatar editing as well as display-name editing
- Home general leaderboard is tappable and opens a dedicated top leaders screen
- General leaderboard has league/trophy progression inspired by Duolingo-style leagues, showing current rank, current trophy, and next trophy target
- Accomplishment stars show progress for player activities like first game, streaks, points, and games played
- Home mode cards are narrowed to four refined modes: Classic, Bot Duel, Marathon, and Custom
- Home includes Live Table public matchmaking and Private Table invite-code play
- Live Table uses a 12-second auto-start countdown and fills empty seats with CPUs up to a 4-player table
- Home mode cards now open a mode detail screen before room creation, explaining what the mode is and how to play it
- Custom mode lets the player set rules before play: bot count, bot difficulty, round count, timer length, scoring style, and categories
- Custom mode also lets the player choose whether scoring starts with self-scoring or opponents scoring the player's answers
- Marathon mode uses a fixed total match timer with no round cap; players keep starting rounds and scoring until time runs out
- First launch shows a quick "How to play" rules screen before Home; Home also has a How to Play button
- Local player profile stores all-time points, games played, current streak, and best streak on device
- Settings screen with music, sound effects, haptics, sound FX pack, themes, How to Play, and About entries
- About credits the game as made by Mr A and Hikari
- Settings music/sound FX toggles now control in-app audio playback through `expo-audio`
- Music now follows the active mode with modern calm generated loops for Classic/Custom, Bot Duel, and Marathon
- Sound FX packs use local CC0 MP3 assets from `rse/soundfx`
- Themes screen with selectable visual themes
- Display name input
- Create Room action backed by local Supabase
- Join Room screen
- Room code input
- Join Room action backed by local Supabase
- Lobby screen
- Rooms created from the app stay available for 15 minutes and the lobby shows the remaining availability time
- Online room snapshots track lifecycle status and mark expired rooms as expired
- Expired online rooms show a Room Expired pop-up and return the player home
- Returning online players can rejoin started rooms with the same room code before expiry
- App startup can restore the latest active online room for the same device and return the player to Lobby, Round, or Reveal
- Rejoin restores the player's name, room role, active round, saved answers, and online score/vote sync
- Rejoined players see a confirmation pop-up before continuing
- Online rooms track host authority; if the active host leaves, the earliest active player is promoted
- Non-host online players wait for the host to start or finish rounds
- Lobby shows a compact match setup summary before starting: mode, rounds/time, timer, bots, scoring owner, categories, and scoring style
- Lobby setup stats use icons for players, spectators, and rounds
- Lobby supports local bot opponents with count and difficulty controls
- Lobby supports selecting target match length in rounds
- Lobby supports selecting timer length and Classic/Strict scoring
- Round categories can be selected before starting a round
- Starter categories display
- Local room-code generation
- Start Round action
- Round screen
- Round letters use a persisted letter bag so recent letters are avoided until the alphabet has cycled
- 90-second local timer
- Category answer inputs based on selected categories
- Keyboard-safe layout leaves extra bottom space while typing
- Local answer submission summary
- Reveal answers screen
- Online answer submission now writes answer rows and round score rows to Supabase
- Online Reveal/Leaderboard now poll Supabase for shared answers, votes, and round scores while open
- Online Reveal shows table agreement progress: submitted players, expected votes, received votes, and ready status
- First-time Reveal shows a scoring pop-up telling players to score themselves
- First-time scoring guidance now explains the simple loop: score, dispute only when needed, then vote Full/Half/Reject
- Valid / duplicate / invalid verdict controls
- Reveal supports disputing the player's answer after it has been scored and asking the table to vote count/reject
- Bot opponents can dispute the player's scored answers during Reveal
- Player can dispute bot/opponent answers and vote to count or reject them; bot answer points update from the vote
- Dispute voting supports Full, Half, and Reject outcomes
- Online verdict changes and player dispute votes now persist to Supabase for the current player
- Reveal shows other online players' answers, verdicts, points, and vote counts under each category
- Reveal lets the player vote Full/Half/Reject on other online players' answers; votes persist and update the answer verdict/points plus round score
- Online Finish Round waits until active players have submitted and expected votes are complete
- Online devices move from Reveal to Leaderboard when the host finishes the shared round
- Disputes show the challenged/suggested result and the final vote result
- Reveal includes a compact dispute summary showing challenged answers, suggested result, final vote, and resulting points
- Bot opponents can counter the player's dispute with their own suggested result
- Disputes show a vote ledger for the player and every bot/opponent
- Majority wins dispute votes; if the table is tied, the main player breaks the tie
- Bot challenges against the player's word open a dispute overlay before returning to score review
- Multiple bot challenges stack in one dispute pop-up so players can see every challenged word before voting
- Reveal has a visible top back button to return to the lobby
- Local score calculation
- Round total display
- Finish Round action
- Leaderboard screen
- Completed matches show Play Again and New Game actions
- Final online rounds mark the room as finished instead of returning it to the lobby
- Completed matches show a game-over pop-up with win/position, points, and newly unlocked achievements when present
- Completed matches also keep win/position, total points, last-round points, and achievement/league status visible on the leaderboard screen
- Leaving or starting a new game from an active room now asks for confirmation and explains the room's remaining availability
- Cumulative score display
- Leaderboard standings include local bot opponents with random player-style names
- Leaderboard shows online round scores from Supabase when the room is online
- Online Leaderboard standings now aggregate Supabase `round_scores` across the whole room, so every device sees the same match totals, leader, rank, last-round score, and player round history
- Bot opponents generate visible answers per category during Reveal
- Bot opponents pick visible answers randomly from a local 546-answer category word bank covering the seven starter categories
- Bot opponents can make visible spelling mistakes; easier bots misspell more often and those answers score as variants
- Local round history
- Automated scoring tests in `packages/game-core`
- Local game state extracted into `apps/mobile/src/useLocalGame.ts`
- Supabase client and room service added in `apps/mobile/src`
- Anonymous device player ID stored locally for rejoin/reconnect
- Secure-readable six-character room codes
- Taste Skill pass applied to Lobby and Round screens
- Taste Skill pass applied to Reveal/Score and Leaderboard screens
- Variant verdict available in reveal scoring
- Lucide React Native icons added for home actions and settings controls

## MVP Defaults

- Platform: Android first
- Testing: real phone with Expo Go
- Scoring: player voting first, hybrid validation later
- Visual direction: clean
- Online backend: Supabase

## Future Validation

Hybrid validation can layer on after the first playable loop:

- Players vote valid or invalid in MVP.
- Dictionary/API checks can suggest likely invalid answers later.
- Host or majority vote remains the final decision when validation is unclear.
