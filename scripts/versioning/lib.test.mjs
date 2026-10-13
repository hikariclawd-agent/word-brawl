import { describe, expect, it } from 'vitest';

import { parseGeneratedBuildMetadata, validateSemver } from './lib.mjs';

describe('versioning helpers', () => {
  it('accepts semantic release versions and rejects loose labels', () => {
    expect(validateSemver('1.0.1')).toBe(true);
    expect(validateSemver('2.3.4-beta.1')).toBe(true);
    expect(validateSemver('1.0')).toBe(false);
    expect(validateSemver('latest')).toBe(false);
  });

  it('parses the generated build metadata module', () => {
    expect(
      parseGeneratedBuildMetadata(`
        export const BUILD_METADATA = {
          appVersion: "1.0.1",
          buildIdentifier: "ios:1/android:1",
          buildDate: "2026-10-11T00:00:00.000Z",
          environment: "development",
          gitCommit: "abc1234",
        } as const;
      `),
    ).toEqual({
      appVersion: '1.0.1',
      buildIdentifier: 'ios:1/android:1',
      buildDate: '2026-10-11T00:00:00.000Z',
      environment: 'development',
      gitCommit: 'abc1234',
    });
  });
});

