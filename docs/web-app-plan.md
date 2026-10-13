# Word Brawl Web App Plan

## Current State

Word Brawl already exports to web through Expo:

```sh
corepack pnpm --filter mobile exec expo export --platform web --clear --output-dir /tmp/word-brawl-web
```

That output is a static web app. It can be hosted behind any static host if `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` point at the hosted Supabase project.

## Fastest Web Launch

1. Keep the current Expo app.
2. Freeze any major scoring UI redesign until the final mobile layout is designed.
3. Deploy the Expo web export to a static host.
4. Add a custom domain.
5. Use the hosted Supabase project as the backend.

This is the quickest beta route because it reuses the existing app and backend.

## Better Product Web App

Build a dedicated web app only after the game loop is stable:

1. Create `apps/web` with Vite or Next.js.
2. Import shared logic from `packages/game-core` and constants from `packages/shared`.
3. Keep Supabase data access behind a small client API layer.
4. Split the giant mobile `App.tsx` into screens and feature components before copying logic into web.
5. Move authoritative multiplayer actions into Supabase RPC or Edge Functions.

This gives a cleaner desktop/mobile web experience without throwing away the current game.

## Backend Hardening Before Public Web

- Replace beta-open RLS policies with room/player ownership checks.
- Add rate limits for room creation, joining, reports, votes, and disputes.
- Move round start, submit, vote, dispute resolution, and finish-round authority server-side.
- Add analytics/error logging for failed room sync, failed submits, and abandoned rounds.
- Add a staging Supabase project before public users touch production.

## Performance Priorities

- Extract screens/components from `apps/mobile/App.tsx`.
- Debounce online draft answer saves.
- Avoid polling heavy match standings every second.
- Keep reveal/scoring snapshots responsive, but push heavier reads to slower intervals.
- Lazy-load or reduce audio assets for web.
- Add indexes that match matchmaking, resume, player, and round-history queries.

## Recommended Path

For the next beta, use Expo Web as the web app. After the scoring UI and game loop are stable, build a dedicated `apps/web` front end.
