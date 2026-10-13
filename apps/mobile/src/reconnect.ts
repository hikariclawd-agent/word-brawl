export const RECONNECT_GRACE_MS = 12_000;

export type ReconnectSeat = {
  left_at?: string | null;
  status?: 'active' | 'disconnected' | 'left' | 'kicked' | 'timed_out' | 'banned';
};

export type RejoinDecision = 'insert' | 'reactivate' | 'reject';

/**
 * A disconnected seat remains owned by the same device for exactly twelve
 * seconds. The caller keeps the database row/id when reactivating it so
 * answers, scores, and votes cannot be reassigned to a duplicate player.
 */
export function isWithinReconnectGrace(seat: ReconnectSeat, now = Date.now()) {
  if (seat.status === 'active') {
    return true;
  }

  if (seat.status !== 'disconnected' || !seat.left_at) {
    return false;
  }

  const disconnectedAt = new Date(seat.left_at).getTime();
  return Number.isFinite(disconnectedAt) && now - disconnectedAt <= RECONNECT_GRACE_MS;
}

export function getRejoinDecision(existingSeat: ReconnectSeat | null | undefined, now = Date.now()): RejoinDecision {
  if (!existingSeat) {
    return 'insert';
  }

  return isWithinReconnectGrace(existingSeat, now) ? 'reactivate' : 'reject';
}
