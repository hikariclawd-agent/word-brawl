# Live Brawl / Word Brawl browser verification

## Batch 4 continuation outcome — 2026-10-16

The first disposable browser run created one approved test room and submitted five answers through the normal UI. The disposable database contained:

- 1 room, stuck in `revealing`
- 1 round
- 1 player
- 5 answers
- 0 votes
- 0 answer disputes

The browser reached the result/review polling stage, but the modal interaction was not completed with reliable evidence. No conclusion was recorded about whether answer details blocked the result or whether **Continue normally** responded. Native Expo Go remains unverified.

### Diagnosis

The room remained in `revealing` because the disposable API returned `401` for repeated UI-generated `PATCH /rest/v1/rooms` requests. The disposable database log identifies the cause as missing `UPDATE` permission for the `anon` role on `public.rooms`. This was an environment/bootstrap defect, not a manually invoked RPC or a source-code change.

The API container could not be restarted because its declarative Kong configuration was bind-mounted from `/tmp/word-brawl-verify-20261016/supabase/kong.json`; that temporary directory no longer existed. The failed stack was not repaired or reused. Its database volume was preserved for diagnosis only.

Existing local Supabase data remained separate and unchanged. Batch 5 was not started.

## Fresh disposable Batch 4 modal test — 2026-10-16

The broken stack was not repaired. A new migrated volume and internal Docker network were used instead:

- API container: `wb-b4f-20261016-api`
- PostgREST container: `wb-b4f-20261016-rest`
- PostgreSQL container: `wb-b4f-20261016-db`
- Browser/runtime container: `wb-b4f-20261016-runtime`
- Internal network: `wb-b4f-internal-20261016`
- Fresh volume: `wb-b4f-db-20261016`
- Durable evidence/config directory: `.verification/word-brawl-batch4-20261016/`

The internal network has no external route. The browser allowlist permitted only the local static preview and `wb-b4f-20261016-api:54321`; no external HTTP or WebSocket request was observed or permitted. The preview was a static export built from a copied project with dotenv disabled and a disposable Supabase URL/key.

### UI result

Passed through normal UI actions at 390×844:

1. Start Playing → Play as Anonymous → Practice → Start Practice.
2. Start Round, enter five answers, and Submit Answers.
3. Score the Round → Review Scores.
4. Open the answer details, choose **Challenge my score**, and vote **No score · 0**.
5. The challenge notice appeared with **Vote accepted** and a server-resolution message.
6. Click **Continue**. The notice closed, the details layer did not reopen, and the review screen remained usable.

All gameplay writes returned successful responses and targeted only the disposable API. The disposable database recorded resolved challenge data; no production or existing-local writes occurred. The latest UI run left the round in `revealing` because the test intentionally stopped after the modal test and did not finish the round.

### Observation

The notice reported the selected challenge as **No score**, while the subsequent refreshed review state showed the answer at 10 points/valid. The modal interaction itself passed, but this result mismatch should be treated as a separate follow-up defect. It was not investigated further under the narrow test scope.

Native Expo Go remains unverified. Batch 5 was not started.
