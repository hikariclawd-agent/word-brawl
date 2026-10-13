export type TimeoutPhase = 'answering' | 'scoring' | 'dispute' | 'complete';
export type CountdownStatus = 'active' | 'complete' | 'error' | 'expired' | 'loading' | 'unavailable';

export type TimeoutReadiness = {
  activePlayerCount: number;
  expectedVoteCount: number;
  openDisputeCount: number;
  submittedPlayerCount: number;
  voteCount: number;
};

export function getTimeoutPhase(readiness: TimeoutReadiness): TimeoutPhase {
  if (readiness.activePlayerCount <= 0) {
    return 'answering';
  }

  if (readiness.submittedPlayerCount < readiness.activePlayerCount) {
    return 'answering';
  }

  if (readiness.voteCount < readiness.expectedVoteCount) {
    return 'scoring';
  }

  if (readiness.openDisputeCount > 0) {
    return 'dispute';
  }

  return 'complete';
}

export function shouldRequestServerTimeout({
  hasActiveRound,
  isOnline,
  isRoundBusy,
  phase,
  timeRemaining,
}: {
  hasActiveRound: boolean;
  isOnline: boolean;
  isRoundBusy: boolean;
  phase: TimeoutPhase;
  timeRemaining: number;
}) {
  return isOnline && hasActiveRound && !isRoundBusy && timeRemaining <= 0 && phase !== 'complete';
}

export function getPhaseDeadline(
  phase: TimeoutPhase,
  deadlines: {
    disputeEndsAt?: string | null;
    scoringEndsAt?: string | null;
  },
) {
  if (phase === 'scoring') {
    return deadlines.scoringEndsAt ?? null;
  }

  if (phase === 'dispute') {
    return deadlines.disputeEndsAt ?? null;
  }

  return null;
}

export function getDeadlineRemainingSeconds(deadlineIso?: string | null, nowMs = Date.now()) {
  if (!deadlineIso) {
    return null;
  }

  const deadlineMs = Date.parse(deadlineIso);

  if (!Number.isFinite(deadlineMs)) {
    return null;
  }

  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function getCountdownState({
  deadlineIso,
  error,
  isLoading = false,
  nowMs = Date.now(),
  phaseComplete = false,
}: {
  deadlineIso?: string | null;
  error?: string | null;
  isLoading?: boolean;
  nowMs?: number;
  phaseComplete?: boolean;
}): {
  label: string;
  remainingSeconds: number | null;
  status: CountdownStatus;
} {
  if (error) {
    return { label: 'Sync error', remainingSeconds: null, status: 'error' };
  }

  if (phaseComplete) {
    return { label: 'Complete', remainingSeconds: 0, status: 'complete' };
  }

  if (isLoading) {
    return { label: 'Syncing...', remainingSeconds: null, status: 'loading' };
  }

  const remainingSeconds = getDeadlineRemainingSeconds(deadlineIso, nowMs);

  if (remainingSeconds === null) {
    return { label: 'Waiting for server', remainingSeconds: null, status: 'unavailable' };
  }

  if (remainingSeconds <= 0) {
    return { label: 'Expired', remainingSeconds: 0, status: 'expired' };
  }

  return {
    label: `${remainingSeconds}s`,
    remainingSeconds,
    status: 'active',
  };
}
