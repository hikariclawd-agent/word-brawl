import { describe, expect, it } from 'vitest';

import { getRejoinDecision, isWithinReconnectGrace, RECONNECT_GRACE_MS } from './reconnect';

const NOW = Date.parse('2026-10-10T12:00:00.000Z');
const stamp = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('reconnect seat grace', () => {
  it('keeps an active seat and a disconnected seat at the exact 12-second boundary', () => {
    expect(isWithinReconnectGrace({ status: 'active' }, NOW)).toBe(true);
    expect(isWithinReconnectGrace({ status: 'disconnected', left_at: stamp(-RECONNECT_GRACE_MS) }, NOW)).toBe(true);
  });

  it('expires a seat one millisecond after the boundary and rejects invalid timestamps', () => {
    expect(isWithinReconnectGrace({ status: 'disconnected', left_at: stamp(-RECONNECT_GRACE_MS - 1) }, NOW)).toBe(false);
    expect(isWithinReconnectGrace({ status: 'disconnected', left_at: 'not-a-date' }, NOW)).toBe(false);
  });

  it('preserves the existing identity during grace instead of inserting a duplicate', () => {
    expect(getRejoinDecision({ status: 'active' }, NOW)).toBe('reactivate');
    expect(getRejoinDecision({ status: 'disconnected', left_at: stamp(-3_000) }, NOW)).toBe('reactivate');
    expect(getRejoinDecision(null, NOW)).toBe('insert');
  });

  it('does not reactivate expired or terminal seats', () => {
    expect(getRejoinDecision({ status: 'disconnected', left_at: stamp(-RECONNECT_GRACE_MS - 1) }, NOW)).toBe('reject');
    expect(getRejoinDecision({ status: 'left', left_at: stamp(-1_000) }, NOW)).toBe('reject');
  });
});
