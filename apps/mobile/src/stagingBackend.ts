export const STAGING_URL = 'https://fbatkvnkclveccgrlmxo.supabase.co';
export const STAGING_REF = 'fbatkvnkclveccgrlmxo';

// Decode only public JWT claims. Authenticity is checked against the management
// API key during secure build preflight; decoding alone is not authentication.
function publicClaims(key: string): { role?: string; ref?: string } {
  const parts = key.split('.');
  const encoded = parts[1];
  if (parts.length !== 3 || parts.some((part) => !part) || !encoded) throw new Error('Invalid staging public key.');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0;
  let buffer = 0;
  let decoded = '';
  for (const char of encoded.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '')) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error('Invalid staging public key.');
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) { bits -= 8; decoded += String.fromCharCode((buffer >> bits) & 255); }
  }
  try {
    const claims: unknown = JSON.parse(decoded);
    if (!claims || typeof claims !== 'object' || Array.isArray(claims)) throw new Error();
    return claims;
  } catch { throw new Error('Invalid staging public key.'); }
}

export function assertStagingBackend(environment: string | undefined, url: string | undefined, key: string | undefined): void {
  if (environment !== 'staging') return;
  if (url !== STAGING_URL || !key?.trim() || key !== key.trim()) {
    throw new Error('Staging backend configuration is missing or incorrect.');
  }
  // This staging implementation deliberately selects the project's legacy anon
  // JWT, allowing offline role/ref checks in addition to build-time provenance.
  const claims = publicClaims(key);
  if (claims.role !== 'anon' || claims.ref !== STAGING_REF) {
    throw new Error('Staging requires the approved project anonymous key.');
  }
}
