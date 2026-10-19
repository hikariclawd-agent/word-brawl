# Word Brawl

Expo/React Native multiplayer word game inspired by Name, Place, Animal, Thing.

## Stack

- Expo
- React Native
- TypeScript
- Supabase for realtime rooms, persistence and server-authoritative online scoring

## Game paths

- **Local/offline play:** `apps/mobile/src/useLocalGame.ts` owns local match state and orchestration. CPU answer generation, duplicate handling and local CPU scoring live in `apps/mobile/src/localBotRound.ts`.
- **Online play:** `apps/mobile/src/onlineRooms.ts` coordinates Supabase room operations. Online verdicts, points, disputes and final standings come from authoritative server results; client projections are for presentation and interaction only.

## Product Docs

- `docs/prd.md` - product requirements draft.
- `docs/prd-questions.md` - questions to tighten the spec.
- `docs/production-readiness-checklist.md` - production, security, compliance, and launch checks.
- `docs/beta-roadmap.md` - dated roadmap to private beta.
- `docs/database.md` - Supabase schema notes.
- `docs/web-app-plan.md` - path from Expo Web beta to a dedicated web app.

## Run

```sh
corepack pnpm install
corepack pnpm mobile
```

Then scan the Expo QR code with Expo Go on Android.

Useful verification commands:

```sh
corepack pnpm typecheck
corepack pnpm test
corepack pnpm version:check
```
