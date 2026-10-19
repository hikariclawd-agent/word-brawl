# Word Brawl Release Process

The official Word Brawl release version is the mobile app version in `apps/mobile/package.json` and `apps/mobile/app.json`.

The root `package.json` version stays independent because it represents workspace tooling, not the shipped game.

## Version Rules

- PATCH: bug fixes that do not change intended functionality.
- MINOR: backward-compatible features.
- MAJOR: breaking changes.
- Do not bump the app version just because source files changed.
- Bump the app version only when preparing a deliberate release.
- Keep `apps/mobile/package.json` and `apps/mobile/app.json` aligned.
- Keep `expo.ios.buildNumber` and `expo.android.versionCode` present for build identity.

## Commands

```sh
corepack pnpm version:metadata
corepack pnpm version:check
corepack pnpm release:verify
```

`version:metadata` writes `apps/mobile/src/generated/buildMetadata.ts` from the current mobile app metadata, git commit, environment, and build date.

`version:check` verifies:

- mobile package/app JSON version agreement
- valid semantic app version
- available iOS and Android build identifiers
- matching release manifest for the current app version
- all Supabase migration versions are recorded in the manifest
- generated build metadata matches the current app metadata

`release:verify` runs version metadata generation, version checks, game-core tests, mobile tests, typechecks, Expo web export validation, and local Supabase SQL tests.

If any required check fails, the release is not verified. A passing source verification still does not mean a native build was generated, uploaded, or installed on a phone.

## Release Manifests

Release manifests live in `release-manifests/<version>.json`.

Each manifest records:

- app version
- build identifier
- git commit hash
- release date
- database migration versions included
- key features and fixes
- tests executed and results
- known limitations
- installed verification status

### Manifest lifecycle

`source-prepared` is the pre-release state used while a release has not been
frozen, released, or installed and verified. A source-prepared manifest remains
editable during that period, and its `databaseMigrationsIncluded` list must
include every migration present in that release's source.

For a source-prepared manifest, `releaseDate` records the source-preparation
snapshot date. It does not, by itself, freeze the manifest. Once a release is
frozen or released, its manifest becomes historical and must not be rewritten
to include migrations introduced later. Those migrations belong in the manifest
for the subsequent release.

Repository validation applies the all-migrations check to the current release
manifest. Historical manifests are retained as release records and are not
retroactively required to include migrations from later releases.

Do not delete old manifests. They are the release history used to compare versions and track regressions.

## Change Reports

Every implementation task should leave a report at:

```sh
.local-monitor/reports/latest-change-report.md
```

Use these statuses:

- IMPLEMENTED: code is present.
- VERIFIED: the relevant automated or manual test passed.
- RELEASED: the intended build has been packaged and made available.

Never describe a change as fully complete only because the code exists.

## Phone Verification

To see changes on a phone:

1. Run `corepack pnpm version:check`.
2. Run `corepack pnpm release:verify` and fix failures.
3. Generate a native/dev build using the repo's Expo workflow.
4. Install that generated build on the phone.
5. Open Settings, then About, and compare the visible metadata with the release manifest.

Source changes, generated builds, and installed app versions are separate states.
