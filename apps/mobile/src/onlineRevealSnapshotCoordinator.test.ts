import { describe, expect, it } from 'vitest';

import { createOnlineRevealSnapshotCoordinator } from './onlineRevealSnapshotCoordinator';

describe('online reveal snapshot coordination', () => {
  it('keeps only the latest poll request current', () => {
    const coordinator = createOnlineRevealSnapshotCoordinator();
    const first = coordinator.beginRequest('generation:room:round');
    const second = coordinator.beginRequest('generation:room:round');

    expect(coordinator.isCurrent(first)).toBe(false);
    expect(coordinator.isCurrent(second)).toBe(true);
  });

  it('lets an authoritative request supersede polling', () => {
    const coordinator = createOnlineRevealSnapshotCoordinator();
    const poll = coordinator.beginRequest('generation:room:round');
    const mutationEpoch = coordinator.beginMutation();
    const authoritative = coordinator.beginRequest('generation:room:round', 'authoritative');

    expect(coordinator.isCurrent(poll)).toBe(false);
    expect(coordinator.isCurrent(authoritative)).toBe(true);

    coordinator.finishMutation(mutationEpoch);
    expect(coordinator.isCurrent(authoritative)).toBe(false);
  });

  it('does not let a poll replace an active authoritative request', () => {
    const coordinator = createOnlineRevealSnapshotCoordinator();
    coordinator.ensureKey('generation:room:round');
    const mutationEpoch = coordinator.beginMutation();
    const authoritative = coordinator.beginRequest('generation:room:round', 'authoritative');
    const poll = coordinator.beginRequest('generation:room:round');

    expect(coordinator.isCurrent(authoritative)).toBe(true);
    expect(coordinator.isCurrent(poll)).toBe(false);

    coordinator.finishMutation(mutationEpoch);
  });

  it('rejects stale mutation completion after a newer mutation begins', () => {
    const coordinator = createOnlineRevealSnapshotCoordinator();
    coordinator.ensureKey('generation:room:round');
    const firstEpoch = coordinator.beginMutation();
    const secondEpoch = coordinator.beginMutation();

    coordinator.finishMutation(firstEpoch);
    const request = coordinator.beginRequest('generation:room:round', 'authoritative');

    expect(coordinator.isCurrent(request)).toBe(true);
    coordinator.finishMutation(secondEpoch);
    expect(coordinator.isCurrent(request)).toBe(false);
  });

  it('invalidates requests when the room or round key changes', () => {
    const coordinator = createOnlineRevealSnapshotCoordinator();
    const oldRequest = coordinator.beginRequest('generation:room-a:round-1');

    coordinator.ensureKey('generation:room-b:round-1');

    expect(coordinator.isCurrent(oldRequest)).toBe(false);
    expect(coordinator.beginRequest('generation:room-b:round-1')).toMatchObject({
      key: 'generation:room-b:round-1',
      id: 2,
    });
  });

  it('invalidates an authoritative request when the key changes during a mutation', () => {
    const coordinator = createOnlineRevealSnapshotCoordinator();
    coordinator.ensureKey('generation:room-a:round-1');
    const mutationEpoch = coordinator.beginMutation();
    const authoritative = coordinator.beginRequest(
      'generation:room-a:round-1',
      'authoritative',
    );

    coordinator.ensureKey('generation:room-b:round-1');

    expect(coordinator.isCurrent(authoritative)).toBe(false);

    coordinator.finishMutation(mutationEpoch);
  });

  it('invalidates requests explicitly without resetting request IDs', () => {
    const coordinator = createOnlineRevealSnapshotCoordinator();
    const oldRequest = coordinator.beginRequest('generation:room:round-1');

    coordinator.invalidate();
    const nextRequest = coordinator.beginRequest('generation:room:round-1');

    expect(coordinator.isCurrent(oldRequest)).toBe(false);
    expect(nextRequest.id).toBe(2);
  });
});
