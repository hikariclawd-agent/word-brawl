import { describe, expect, it, vi, afterEach } from 'vitest';
import { assertStagingBackend, STAGING_REF, STAGING_URL } from './stagingBackend';
const token = (claims: unknown) => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test-signature`;
const valid = token({ role: 'anon', ref: STAGING_REF });

describe('staging fail-closed backend', () => {
  it.each([undefined, '', ' ', 'http://127.0.0.1:54321', 'https://wrong-project.supabase.co', `${STAGING_URL}/`])('rejects missing/empty/wrong URL (%s)', (url) => {
    expect(() => assertStagingBackend('staging', url, valid)).toThrow();
  });
  it.each([undefined, '', ' ', 'sb_secret_test', 'sb_publishable_test', 'not-a-jwt', `${valid} `,
    token({ role: 'service_role', ref: STAGING_REF }), token({ role: 'anon', ref: 'wrong-project' }),
    token({ role: 'anon' }), token(null), token([]), 'header.%%%%.signature'])('rejects invalid key case %#', (key) => {
    expect(() => assertStagingBackend('staging', STAGING_URL, key)).toThrow();
  });
  it('accepts staging anonymous public claims', () => {
    expect(() => assertStagingBackend('staging', STAGING_URL, valid)).not.toThrow();
  });
  it('preserves the non-staging path', () => {
    expect(() => assertStagingBackend(undefined, undefined, undefined)).not.toThrow();
    expect(() => assertStagingBackend('preview', 'legacy-url', 'legacy-key')).not.toThrow();
  });
});

vi.mock('react-native-url-polyfill/auto', () => ({}));
const { createClient } = vi.hoisted(() => ({ createClient: vi.fn(() => ({})) }));
vi.mock('@supabase/supabase-js', () => ({ createClient }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); createClient.mockClear(); });
describe('client initialization safety', () => {
  it('throws before creating a client for an incorrect staging target', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_ENV', 'staging');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', valid);
    await expect(import('./supabase')).rejects.toThrow();
    expect(createClient).not.toHaveBeenCalled();
  });
  it('initializes exactly the selected staging URL/key with no network', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_ENV', 'staging');
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_URL', STAGING_URL);
    vi.stubEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY', valid);
    await import('./supabase');
    expect(createClient).toHaveBeenCalledExactlyOnceWith(STAGING_URL, valid, { auth: { persistSession: false } });
  });
});
