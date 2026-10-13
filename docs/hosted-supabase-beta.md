# Hosted Supabase Beta

Use this path when moving Word Brawl from local/Tailscale Supabase to hosted HTTPS beta testing.

## Required Inputs

- Supabase access token, or an already logged-in Supabase CLI session.
- Hosted Supabase project ref.
- Hosted database password for `supabase link`.
- Hosted anon key and project URL.
- Hosted Edge Function secrets for `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  and `WORD_VALIDATION_WORKER_SECRET`.

Do not commit real keys. Put local build values in `apps/mobile/.env.local`.
Set Edge Function secrets through Supabase secrets, not mobile env files.

## Deploy Backend

From the repo root:

```sh
corepack pnpm supabase projects list
corepack pnpm supabase link --project-ref <project-ref>
corepack pnpm supabase:db:push
corepack pnpm supabase secrets set SUPABASE_URL=https://<project-ref>.supabase.co
corepack pnpm supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<hosted-service-role-key>
corepack pnpm supabase secrets set WORD_VALIDATION_WORKER_SECRET=<random-worker-secret>
```

If the CLI says an access token is missing, run `supabase login` or export `SUPABASE_ACCESS_TOKEN` first.

## Configure Mobile Build

Create `apps/mobile/.env.local`:

```sh
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<hosted-anon-key>
```

Then rebuild the APK from the mobile Android project:

```sh
cd apps/mobile/android
./gradlew :app:assembleRelease
```

## Smoke Test

Use two devices or one device plus emulator:

1. Install the rebuilt release APK.
2. Create an online room on device A.
3. Join with the room code on device B.
4. Start a round from the host.
5. Submit answers from both devices.
6. Vote on at least one answer.
7. Finish the round and confirm leaderboard/history sync.
8. Invoke `enrich-word-validation` once without a bearer token, once with an
   invalid token, and once with `Authorization: Bearer <worker-secret>`.
   Only the valid token should claim jobs.

## Rollback Notes

- The current pre-staging migrations are additive function/table changes, but
  hosted rollback should still be treated as a release rollback, not an ad hoc
  production edit.
- Before hosted migration apply, capture a Supabase backup/snapshot and record
  the previous migration head.
- If staging fails before user traffic, revert by restoring the pre-deploy
  database snapshot and redeploying the previous Edge Function bundle.
- If staging has live tester data, prefer a forward hotfix migration unless the
  failure blocks core gameplay or risks data integrity.

## Beta Guardrails Before Wider Sharing

- Keep room expiry enabled.
- Keep player and spectator caps.
- Confirm reports write to Supabase.
- Tighten the permissive beta RLS policies before public distribution.
- Use hosted HTTPS only; do not ship Tailscale/local HTTP builds to testers.
