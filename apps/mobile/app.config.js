const childProcess = require('node:child_process');
const appJson = require('./app.json');
const mobilePackage = require('./package.json');

function readGitCommit() {
  if (process.env.WORD_BRAWL_GIT_COMMIT) return process.env.WORD_BRAWL_GIT_COMMIT;

  try {
    return childProcess.execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

function normalizeEnvironment(value) {
  if (value === 'production' || value === 'preview' || value === 'development') return value;
  if (value === 'prod') return 'production';
  if (value === 'dev' || value === 'test') return 'development';
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

const expo = appJson.expo;
const iosBuildNumber = expo.ios?.buildNumber ?? '0';
const androidVersionCode = expo.android?.versionCode ?? 0;

module.exports = {
  ...expo,
  owner: 'teech',
  version: mobilePackage.version,
  extra: {
    ...(expo.extra ?? {}),
    eas: {
      ...(expo.extra?.eas ?? {}),
      projectId: '69d790b1-157c-4c70-bb1f-ce9b54fe7e52',
    },
    release: {
      appVersion: mobilePackage.version,
      buildIdentifier: `ios:${iosBuildNumber}/android:${androidVersionCode}`,
      buildDate: process.env.WORD_BRAWL_BUILD_DATE ?? new Date().toISOString(),
      environment: normalizeEnvironment(process.env.EXPO_PUBLIC_APP_ENV ?? process.env.APP_ENV),
      gitCommit: readGitCommit(),
    },
  },
};
