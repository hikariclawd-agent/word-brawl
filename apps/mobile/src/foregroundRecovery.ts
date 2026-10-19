export type ForegroundRecoveryAction = 'active' | 'disconnected';

type ForegroundRecoveryCoordinatorOptions = {
  isCurrent: () => boolean;
  onError: (error: unknown) => void;
};

export function createForegroundRecoveryCoordinator({
  isCurrent,
  onError,
}: ForegroundRecoveryCoordinatorOptions) {
  let sequence = 0;
  let tail = Promise.resolve();

  function invalidate() {
    sequence += 1;
  }

  function schedule(_action: ForegroundRecoveryAction, work: () => Promise<void>) {
    const requestId = ++sequence;
    const run = tail.then(async () => {
      if (!isCurrent() || requestId !== sequence) return;

      try {
        await work();
      } catch (error) {
        if (isCurrent() && requestId === sequence) onError(error);
      }
    });

    tail = run.catch(() => undefined);
    return run;
  }

  return { invalidate, schedule };
}
