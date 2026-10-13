# Database

## Migration

Initial schema:

- `supabase/migrations/20260627231500_initial_game_schema.sql`

## CLI

Supabase CLI is installed as a local dev dependency.

Useful commands:

- `corepack pnpm supabase --version`
- `corepack pnpm supabase:start`
- `corepack pnpm supabase:status`
- `corepack pnpm supabase:db:reset`
- `corepack pnpm supabase:db:push`

Local Supabase requires Docker. If Docker is not installed or the Docker daemon is not running, the CLI can be installed and configured, but the local stack and migration reset cannot run.

Current local status:

- Docker Engine is installed and running on the development laptop.
- Local Supabase starts successfully through Docker.
- Because the current shell may not have picked up the new `docker` group yet, use `sg docker -c 'corepack pnpm supabase:status'` if normal Docker commands return permission errors.
- The initial migration has been applied successfully to the local database.
- Beta REST access is granted to the local `anon` and `authenticated` roles for the current anonymous-room flow.
- Supabase Studio is available locally at `http://127.0.0.1:54323` while the stack is running.

## Mobile Local URL

Expo Go runs on the phone, so the app cannot use `127.0.0.1` for Supabase. The current local phone-facing URL is stored in `apps/mobile/.env.local`:

- `EXPO_PUBLIC_SUPABASE_URL=http://10.28.194.206:54321`

If the laptop changes Wi-Fi/network and this IP changes, update `.env.local` and restart Expo.

For hosted beta testing, use `docs/hosted-supabase-beta.md` and point `apps/mobile/.env.local` at the hosted HTTPS Supabase URL instead of the local/Tailscale URL.

## Tables

- `rooms` - private room shell, code, status, expiry, limits.
- `room_players` - anonymous player/spectator records per room.
- `rounds` - round number, letter, timing, status.
- `answers` - submitted answers by category.
- `votes` - per-answer player votes.
- `round_scores` - scored round totals per player.
- `category_packs` - default and future paid/custom packs.
- `categories` - categories inside each pack.
- `reports` - answer/player moderation reports.
- `abuse_strikes` - rolling moderation actions.

## Current Beta Rules

- Room code format: six secure-readable characters, e.g. `A7KQ9Z`.
- Room expiry: 1 hour.
- Player cap: 8.
- Spectator cap: 20.
- Round timer default: 90 seconds.
- Reported answers are retained for moderation review.
- Abuse strikes use a 5-day window.

## RLS

RLS is enabled on all tables.

The first migration uses permissive beta policies so anonymous device players can create and join rooms before account auth exists. These policies must be tightened before public launch when accounts, paid users, and stronger moderation are added.

Postgres privileges are also granted to `anon` and `authenticated` for beta. Without the grants, RLS policies alone are not enough for REST access.
