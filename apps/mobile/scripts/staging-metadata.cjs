const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

// No credentials are written to the generated module or error messages.
function resolveMetadata(env, expected, app, version, readCommit) {
  if (env.EXPO_PUBLIC_BACKEND_ENV !== 'staging') return null;
  const key = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (env.EXPO_PUBLIC_SUPABASE_URL !== expected.url || !key ||
      crypto.createHash('sha256').update(key).digest('hex') !== expected.sha256) {
    throw new Error('Staging backend provenance check failed.');
  }
  if (env.EAS_BUILD_GIT_COMMIT_HASH && env.WORD_BRAWL_GIT_COMMIT &&
      env.EAS_BUILD_GIT_COMMIT_HASH !== env.WORD_BRAWL_GIT_COMMIT) {
    throw new Error('Conflicting staging commit identifiers.');
  }
  const sha = env.EAS_BUILD_GIT_COMMIT_HASH || env.WORD_BRAWL_GIT_COMMIT || readCommit();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Staging requires an exact Git commit SHA.');
  return {
    appVersion: version,
    buildIdentifier: `ios:${app.ios.buildNumber}/android:${app.android.versionCode}`,
    buildDate: env.WORD_BRAWL_BUILD_DATE || new Date().toISOString(),
    environment: 'staging', gitCommit: sha,
  };
}

function prepareStagingMetadata() {
  if (process.env.EXPO_PUBLIC_BACKEND_ENV !== 'staging') return;
  const root = path.resolve(__dirname, '..');
  const metadata = resolveMetadata(process.env, require('../staging-public-key.json'),
    require('../app.json').expo, require('../package.json').version,
    () => cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  fs.writeFileSync(path.join(root, 'src/generated/buildMetadata.ts'),
    '// Generated during staging bundling; do not commit build-specific output.\n' +
    'export const BUILD_METADATA = {\n' +
    Object.entries(metadata).map(([key, value]) => `  ${key}: ${JSON.stringify(value)},`).join('\n') +
    '\n} as const;\n');
}
module.exports = prepareStagingMetadata;
module.exports.resolveMetadata = resolveMetadata;
