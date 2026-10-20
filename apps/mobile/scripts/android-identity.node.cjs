// Run with EAS_CLI_ROOT pointing to the installed eas-cli package and
// ANDROID_IDENTITY_PROJECT pointing to a disposable EAS upload copy's mobile dir.
// ANDROID_HOME must contain the SDK. Never runs an assemble/build/signing task.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const mobile = path.resolve(__dirname, '..');
const root = path.resolve(mobile, '../..');
const baseline = '658fe544c94ef7757fe5e0d1da684cd64a15df6e';
const read = p => fs.readFileSync(path.join(mobile, p), 'utf8');
const original = p => cp.execFileSync('git', ['show', `${baseline}:apps/mobile/${p}`], { cwd: root, encoding: 'utf8' });
const config = JSON.parse(read('eas.json'));
assert(process.env.EAS_CLI_ROOT, 'EAS_CLI_ROOT is required; do not substitute a mock parser');
assert(process.env.ANDROID_IDENTITY_PROJECT, 'ANDROID_IDENTITY_PROJECT must be a disposable native project copy');
const easRoot = path.resolve(process.env.EAS_CLI_ROOT);
const native = path.resolve(process.env.ANDROID_IDENTITY_PROJECT);
assert.notEqual(fs.realpathSync(native), fs.realpathSync(mobile), 'Native checks must not write build caches into source');
assert.equal(fs.readFileSync(path.join(native, 'android/app/build.gradle'), 'utf8'), read('android/app/build.gradle'), 'Native test copy is stale');
const eas = f => require(path.join(easRoot, 'build', f));
assert.equal(eas('env').default.overrideAndroidApplicationId, undefined, 'Do not bypass EAS package resolution with an override');
const ids = { preview: 'com.anonymous.animalnameplace', staging: 'com.anonymous.animalnameplace.staging' };
const resolved = {};

test('EAS schema and protected preview profile', () => {
  const { createRequire } = require('node:module');
  const req = createRequire(path.join(easRoot, 'package.json'));
  assert.equal(req('@expo/eas-json/build/schema').EasJsonSchema.validate(config).error, undefined);
  assert.deepEqual(config.build['preview-apk'], JSON.parse(original('eas.json')).build['preview-apk']);
  assert.equal(config.build['staging-apk'].environment, 'development');
  assert.equal(config.build['staging-apk'].android.gradleCommand, ':app:assembleStagingRelease');
  assert.equal(config.build['staging-apk'].env.EXPO_PUBLIC_BACKEND_ENV, 'staging');
  assert.equal(config.build['staging-apk'].env.EXPO_NO_DOTENV, '1');
});

for (const flavor of ['staging', 'preview']) {
  test(`installed EAS resolver selects ${flavor} application ID`, async () => {
    const ignore = await eas('vcs/local').Ignore.createForCheckingAsync(root);
    const vcs = { getRootPathAsync: async () => root, isFileIgnoredAsync: async p => ignore.ignores(p) };
    const profile = config.build[`${flavor}-apk`];
    const ctx = await eas('project/android/gradle').resolveGradleBuildContextAsync(mobile, { ...profile, ...profile.android }, vcs);
    assert.equal(ctx.moduleName, 'app');
    assert.equal(ctx.flavor, flavor === 'staging' ? 'staging' : undefined);
    resolved[flavor] = await eas('project/android/applicationId').getApplicationIdAsync(mobile, {}, vcs, ctx);
    assert.equal(resolved[flavor], ids[flavor]);
  });

  test(`real Gradle ${flavor} variants, labels, namespace and EAS agreement`, () => {
    const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'JAVA_HOME', 'ANDROID_HOME'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    Object.assign(env, { EXPO_NO_DOTENV: '1', EXPO_NO_TELEMETRY: '1', CI: '1',
      EAS_BUILD_GIT_COMMIT_HASH: cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() });
    if (flavor === 'staging') Object.assign(env, config.build['staging-apk'].env);
    const output = cp.execFileSync('./gradlew', ['--offline', '--no-daemon', '--console=plain',
      '-I', path.join(__dirname, 'android-identity.init.gradle'), ':app:verifyWordBrawlIdentity'],
    { cwd: path.join(native, 'android'), env, encoding: 'utf8', timeout: 300000, maxBuffer: 10 * 1024 * 1024 });
    const line = output.split('\n').find(l => l.startsWith('WORD_BRAWL_IDENTITIES='));
    assert(line, 'Real Android Gradle Plugin must report its configured variants');
    const report = JSON.parse(line.slice('WORD_BRAWL_IDENTITIES='.length));
    const variants = report.variants;
    assert.deepEqual(report.releaseTasks, [`:app:assemble${flavor[0].toUpperCase() + flavor.slice(1)}Release`]);
    assert.equal(report.stagingTaskExists, flavor === 'staging', 'Mismatched staging task must not exist');
    assert.deepEqual(variants.map(v => v.name).sort(), [`${flavor}Debug`, `${flavor}DebugOptimized`, `${flavor}Release`]);
    for (const v of variants) {
      assert.equal(v.applicationId, ids[flavor]);
      assert.equal(v.applicationId, resolved[flavor]);
      assert.equal(v.namespace, ids.preview);
      assert.equal(v.label, flavor === 'staging' ? 'Word Brawl Staging' : '@string/app_name');
    }
  });
}

test('native manifest, classes, resources, signing and backend guards are unchanged', () => {
  for (const p of ['android/app/src/main/AndroidManifest.xml',
    'android/app/src/main/java/com/anonymous/animalnameplace/MainActivity.kt',
    'android/app/src/main/java/com/anonymous/animalnameplace/MainApplication.kt',
    'android/app/src/main/res/values/strings.xml', 'src/stagingBackend.ts', 'src/supabase.ts',
    'scripts/staging-metadata.cjs', 'staging-public-key.json']) assert.equal(read(p), original(p), p);
  const gradle = read('android/app/build.gradle');
  const signingAndBuildTypes = s => s.slice(s.indexOf('    signingConfigs {'), s.indexOf('    packagingOptions {'));
  assert.equal(signingAndBuildTypes(gradle), signingAndBuildTypes(original('android/app/build.gradle')));
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  for (const cls of ['MainApplication', 'MainActivity']) assert(manifest.includes(`android:name="${ids.preview}.${cls}"`));
  assert(manifest.includes('android:label="${wordBrawlLabel}"'));
  assert(manifest.includes('android:name="expo.modules.updates.ENABLED" android:value="false"'));
  assert(read('android/app/src/main/res/values/strings.xml').includes('Animal Name Place'));
  assert(gradle.includes('debuggableVariants = ["previewDebug", "stagingDebug"]'));
});


test('Expo identity, owner, project, staging metadata and OTA agree with native targets', () => {
  for (const flavor of ['preview', 'staging']) {
    const sha = cp.execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, EXPO_NO_DOTENV: '1', EAS_BUILD_GIT_COMMIT_HASH: sha };
    if (flavor === 'staging') Object.assign(env, config.build['staging-apk'].env);
    const app = JSON.parse(cp.execFileSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./app.config.js')))"], { cwd: mobile, env, encoding: 'utf8' }));
    assert.equal(app.android.package, ids[flavor]);
    assert.equal(app.owner, 'teech');
    assert.equal(app.extra.eas.projectId, '69d790b1-157c-4c70-bb1f-ce9b54fe7e52');
    assert.equal(app.extra.release.gitCommit, sha);
    if (flavor === 'staging') {
      assert.equal(app.name, 'Word Brawl Staging');
      assert.equal(app.extra.release.environment, 'staging');
      assert.equal(app.updates.enabled, false);
    }
  }
});
