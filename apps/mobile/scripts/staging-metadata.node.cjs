const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { resolveMetadata } = require('./staging-metadata.cjs');
const env = { EXPO_PUBLIC_BACKEND_ENV: 'staging', EXPO_PUBLIC_SUPABASE_URL: 'https://staging.example', EXPO_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key' };
const expected = { url: env.EXPO_PUBLIC_SUPABASE_URL, sha256: crypto.createHash('sha256').update(env.EXPO_PUBLIC_SUPABASE_ANON_KEY).digest('hex') };
const app = { ios: { buildNumber: '9' }, android: { versionCode: 9 } };
const sha = 'a'.repeat(40);
const resolve = (overrides = {}, read = () => sha) => resolveMetadata({ ...env, ...overrides }, expected, app, '1.1.0', read);
test('remote EAS commit works without a Git checkout', () => {
  const result = resolve({ EAS_BUILD_GIT_COMMIT_HASH: sha }, () => { throw Error('No git'); });
  assert.equal(result.gitCommit, sha); assert.equal(result.environment, 'staging');
  assert.equal(result.buildIdentifier, 'ios:9/android:9');
});
test('local commit and fixed date are exact', () => {
  const result = resolve({ WORD_BRAWL_BUILD_DATE: '2026-10-20T00:00:00Z' });
  assert.equal(result.gitCommit, sha); assert.equal(result.buildDate, '2026-10-20T00:00:00Z');
});
test('preview does not rewrite metadata', () => assert.equal(resolve({ EXPO_PUBLIC_BACKEND_ENV: 'preview' }), null));
for (const [name, overrides] of [
  ['missing URL', { EXPO_PUBLIC_SUPABASE_URL: undefined }],
  ['wrong URL', { EXPO_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' }],
  ['missing key', { EXPO_PUBLIC_SUPABASE_ANON_KEY: undefined }],
  ['empty key', { EXPO_PUBLIC_SUPABASE_ANON_KEY: '' }],
  ['wrong key fingerprint', { EXPO_PUBLIC_SUPABASE_ANON_KEY: 'different-public-key' }],
  ['short commit', { WORD_BRAWL_GIT_COMMIT: 'c645a7c' }],
  ['unknown commit', { EAS_BUILD_GIT_COMMIT_HASH: 'unknown' }],
  ['conflicting commit', { EAS_BUILD_GIT_COMMIT_HASH: sha, WORD_BRAWL_GIT_COMMIT: 'b'.repeat(40) }],
]) test(`rejects ${name}`, () => assert.throws(() => resolve(overrides)));
