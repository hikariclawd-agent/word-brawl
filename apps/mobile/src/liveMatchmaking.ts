export const REAL_PLAYER_WAIT_MS = 650;

/** One deadline per open seat; roster updates start the next human-search window. */
export function remainingSearchMs(startedAt: number, now = Date.now()) {
  return Math.max(0, REAL_PLAYER_WAIT_MS - (now - startedAt));
}

export function createSingleFlight() {
  let pending: Promise<unknown> | null = null;
  return <T>(work: () => Promise<T>): Promise<T> => {
    if (pending) return pending as Promise<T>;
    const promise = Promise.resolve().then(work);
    pending = promise;
    void promise.finally(() => { if (pending === promise) pending = null; }).catch(() => undefined);
    return promise;
  };
}
