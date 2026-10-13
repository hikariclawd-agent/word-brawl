type DiagnosticDetails = Record<string, unknown>;

const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;

export function debugGameEvent(event: string, details?: DiagnosticDetails) {
  if (!isDevelopment) {
    return;
  }

  console.debug(`[game] ${event}`, details ?? '');
}

export function debugGameError(event: string, error: unknown, details?: DiagnosticDetails) {
  if (!isDevelopment) {
    return;
  }

  console.error(`[game] ${event}`, { error, ...details });
}

export function installWebDiagnostics() {
  if (!isDevelopment || typeof window === 'undefined') {
    return () => undefined;
  }

  // React Native exposes a partial `window` object, but it does not provide
  // the browser event and fetch APIs used by these diagnostics. Treat this as
  // a browser-only install instead of crashing the native app during render.
  if (
    typeof window.addEventListener !== 'function'
    || typeof window.removeEventListener !== 'function'
    || typeof window.fetch !== 'function'
  ) {
    return () => undefined;
  }

  const onError = (event: ErrorEvent) => {
    debugGameError('window.error', event.error ?? event.message, { source: event.filename, line: event.lineno });
  };
  const onUnhandledRejection = (event: PromiseRejectionEvent) => {
    debugGameError('unhandled-rejection', event.reason);
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onUnhandledRejection);

  const originalFetch = window.fetch.bind(window);
  const diagnosticFetch: typeof window.fetch = async (...args) => {
    const responseUrl = typeof args[0] === 'string' ? args[0] : args[0] instanceof Request ? args[0].url : 'unknown';

    try {
      const response = await originalFetch(...args);

      if (!response.ok) {
        debugGameError('request-failed', new Error(`${response.status} ${response.statusText}`), {
          status: response.status,
          url: responseUrl,
        });
      }

      return response;
    } catch (error) {
      debugGameError('request-error', error, { url: responseUrl });
      throw error;
    }
  };

  window.fetch = diagnosticFetch;

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onUnhandledRejection);
    if (window.fetch === diagnosticFetch) {
      window.fetch = originalFetch;
    }
  };
}
