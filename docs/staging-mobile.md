# Staging Android configuration

`staging-apk` uses the existing **development** EAS environment in
`@teech/word-brawl`. This is an ordinary internal release APK profile, not an Expo
development-client build. `preview-apk` and its preview variables are separate.

## Boundaries

- Staging application ID: `com.anonymous.animalnameplace.staging`.
- Staging launcher: `Word Brawl Staging`.
- Existing preview application ID and launcher resource are unchanged.
- Native namespace stays `com.anonymous.animalnameplace`; manifest component names
  are fully qualified so staging does not look for nonexistent Kotlin classes.
- OTA updates remain disabled. Do not add a channel or enable updates incidentally.
- The only remote backend variables are project-scoped, development-only
  `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`.
- Never overwrite preview/account variables or use a service-role/secret key.

## Native identity and EAS compatibility

EAS CLI 25.2.0 parses Gradle statically: it cannot evaluate a conditional
`applicationId`. Keep the preview ID literal in `defaultConfig` and the staging
ID literal in the `staging` product flavor. Do not use `applicationIdSuffix`.
`staging-apk` explicitly invokes `:app:assembleStagingRelease` so EAS resolves
that flavor before selecting credentials. The unchanged preview profile uses
the default ID and default release command.

`androidComponents.beforeVariants` enables only the flavor selected by
`EXPO_PUBLIC_BACKEND_ENV`. Thus ordinary `assembleRelease` produces only preview,
and requesting a staging task without the staging marker cannot fall back to
preview. Labels are flavor-specific; namespace and native classes stay unchanged.
Both flavored debug variants remain debuggable in the React Native plugin.

Run the regression suite against the installed CLI and a disposable EAS upload
copy (with dependencies available), never the source checkout:

```sh
EAS_CLI_ROOT=/path/to/node_modules/eas-cli \
ANDROID_IDENTITY_PROJECT=/path/to/upload-copy/apps/mobile \
ANDROID_HOME=/path/to/android-sdk \
node --test apps/mobile/scripts/android-identity.node.cjs
```

It executes EAS's actual profile-to-Gradle context and package resolver, then a
configuration-only Gradle task using the real Android Gradle Plugin. It checks
both enabled variant sets, IDs, labels, namespace, and EAS/Gradle agreement.
No assembly or signing task is run; offline Gradle dependencies must be cached.

## Fail-closed path

The staging profile sets both `EXPO_PUBLIC_BACKEND_ENV=staging` and
`EXPO_PUBLIC_APP_ENV=staging`, plus `EXPO_NO_DOTENV=1`. The mobile guard runs before
`createClient` and rejects a missing/empty/non-exact URL or a missing/malformed key,
wrong project ref, or non-anon role. This implementation deliberately uses the
verified project's legacy anon JWT; opaque publishable keys require a separately
reviewed migration. Decoded JWT claims alone are not authenticity proof.

Metro additionally compares the URL and key SHA-256 to `staging-public-key.json`.
The fingerprint was derived from the public anon key returned by the verified
staging project's management API; the key itself is not committed. A rotated key
requires a new authorized provenance check and fingerprint update, not bypassing
the guard. EXPO_PUBLIC values are public client configuration, not app secrets.

## Metadata and uploads

Before staging bundling, `metro.config.js` runs the mobile-local metadata helper.
It verifies backend provenance and generates the Settings `BUILD_METADATA` module
with staging, the version/build number, timestamp and a full 40-character SHA.
It uses EAS's `EAS_BUILD_GIT_COMMIT_HASH`, an explicitly supplied
`WORD_BRAWL_GIT_COMMIT`, or local Git HEAD. Conflicting explicit commit values,
short/unknown SHAs and unavailable Git without an explicit SHA fail closed.

The generated module is build output; do not commit per-build output over the
checked-in default. The helper overwrites that default **before** Metro reads it.
App config also recognizes the EAS commit variable. Non-staging Metro sessions do
not run staging metadata generation. Perform exports in an isolated clean copy
so generated staging metadata cannot leak into a subsequent local preview run.

Root `.easignore` explicitly includes the mobile-local metadata helper; it does
not depend on the root `scripts/versioning` directory being uploaded. Verify the
helper, pin, Metro config, native source, workspace packages and lockfile are in
the candidate upload. Exclude dotenv files, old output/caches and signing files.

## Required checks before a separately authorized build

1. Require a clean committed source checkout and verify the intended full SHA.
   Do not build dirty source while displaying only its parent commit as metadata.
2. Independently read development variables and compare the key to the approved
   staging management API result and pin, without printing values. Compare
   preview/account assignments and fingerprints to their protected baseline.
   Never recreate existing variables as a verification step.
3. Run frozen installation, workspace TypeScript, mobile/core/versioning unit
   tests, and `node --test apps/mobile/scripts/staging-metadata.node.cjs`.
4. Run `android-identity.node.cjs` as above: validate the EAS profile, actual EAS
   resolver and Gradle variants, labels, manifest classes and unchanged signing.
   A distinct package ID establishes identity separation, not proof of physical
   installation.
5. Export a fresh Android JS bundle in isolated scratch with an allowlisted
   environment, no dotenv/caches, and outbound networking blocked. Set both
   staging markers and the exact SHA, using only the verified staging public
   URL/key. Do not start the app against either database.
6. Run `apps/mobile/scripts/verify-staging-bundle.cjs` with the emitted JS path,
   a permission-restricted JSON file containing the two public variables, and
   the full SHA. It registers only Metro module declarations and executes the
   compiled guard, client module (with a stub client), and metadata module. It
   verifies actual initialization arguments and metadata without app startup or
   network access; it does not print the key. Remove temporary key-transfer files.
7. Independently verify the approved existing EAS signing associations using
   metadata-only reads; source configuration does not prove remote readiness.
   Do not generate/download/rotate credentials as an incidental step. Existing
   preview signing must be preserved.
   After separate authorization, use noninteractive credential-freeze protection
   (`--freeze-credentials`) for any EAS submission so missing credentials block
   rather than trigger creation. No build is authorized by this document.

A JS export is not an APK. Actual Gradle compilation, APK signer inspection,
installation coexistence, device rendering and gameplay require later approval.
No database writes are part of these checks.
