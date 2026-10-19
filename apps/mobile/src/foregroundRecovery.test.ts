import { describe, expect, it, vi } from 'vitest';

import { createForegroundRecoveryCoordinator } from './foregroundRecovery';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('foreground recovery transition ordering', () => {
  it('coalesces a pending background transition behind a newer foreground transition', async () => {
    const events: string[] = [];
    const recovery = createForegroundRecoveryCoordinator({
      isCurrent: () => true,
      onError: () => undefined,
    });
    const background = deferred<void>();
    const foreground = deferred<void>();

    const backgroundRun = recovery.schedule('disconnected', async () => {
      events.push('background');
      await background.promise;
    });
    const foregroundRun = recovery.schedule('active', async () => {
      events.push('foreground');
      await foreground.promise;
    });

    await flush();
    expect(events).toEqual(['foreground']);
    foreground.resolve();
    await foregroundRun;
    await backgroundRun;
    expect(events).toEqual(['foreground']);
  });

  it('runs a newer foreground transition after an already-started background transition', async () => {
    const events: string[] = [];
    const recovery = createForegroundRecoveryCoordinator({
      isCurrent: () => true,
      onError: () => undefined,
    });
    const background = deferred<void>();
    const foreground = deferred<void>();

    const backgroundRun = recovery.schedule('disconnected', async () => {
      events.push('background');
      await background.promise;
    });
    await flush();
    const foregroundRun = recovery.schedule('active', async () => {
      events.push('foreground');
      await foreground.promise;
    });

    expect(events).toEqual(['background']);
    background.resolve();
    await backgroundRun;
    await flush();
    expect(events).toEqual(['background', 'foreground']);
    foreground.resolve();
    await foregroundRun;
  });

  it('suppresses a stale failure after the room lifecycle is invalidated', async () => {
    let current = true;
    const onError = vi.fn();
    const recovery = createForegroundRecoveryCoordinator({
      isCurrent: () => current,
      onError,
    });
    const request = deferred<void>();

    const run = recovery.schedule('active', () => request.promise);
    await flush();
    current = false;
    recovery.invalidate();
    request.reject(new Error('old room failed'));
    await run;

    expect(onError).not.toHaveBeenCalled();
  });
});
