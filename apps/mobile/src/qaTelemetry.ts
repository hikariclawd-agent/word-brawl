type QaTelemetryPayload = Record<string, unknown>;

const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;
const telemetryUrl = process.env.EXPO_PUBLIC_HIKARI_QA_TELEMETRY_URL;

export function emitQaTelemetry(event: string, payload: QaTelemetryPayload = {}) {
  if (!isDevelopment || !telemetryUrl || typeof fetch !== 'function') {
    return;
  }

  const cleanPayload = sanitizePayload(payload);

  fetch(telemetryUrl, {
    body: JSON.stringify({
      event,
      payload: cleanPayload,
      timestamp: new Date().toISOString(),
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  }).catch(() => undefined);
}

function sanitizePayload(payload: QaTelemetryPayload): QaTelemetryPayload {
  return Object.fromEntries(Object.entries(payload)
    .filter(([key]) => !key.toLowerCase().includes('answer'))
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        return [key, value.map((entry) => (
          typeof entry === 'object' && entry !== null ? sanitizePayload(entry as QaTelemetryPayload) : entry
        ))];
      }

      if (typeof value === 'object' && value !== null) {
        return [key, sanitizePayload(value as QaTelemetryPayload)];
      }

      return [key, value];
    }));
}
