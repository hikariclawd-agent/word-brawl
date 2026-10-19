import type { OnlineRevealAnswer } from './onlineRooms';
import type { TimeoutReadiness } from './timeoutRules';

export function getHumanScoringWork(answers: readonly OnlineRevealAnswer[], playerId?: string) {
  const required = playerId ? answers.filter((answer) => answer.playerId !== playerId && answer.answer.trim()) : [];
  const pending = required.filter((answer) => !answer.votes.some((vote) => vote.voterPlayerId === playerId));
  return { required, pending, completed: required.length - pending.length };
}

export function getScoringReadiness(input: {
  online: boolean;
  playerId?: string;
  answers: readonly OnlineRevealAnswer[];
  agreement: TimeoutReadiness & { isRoundReady: boolean };
  busy: boolean;
  mayFinish: boolean;
  localPendingScores: boolean;
  localOpenDisputes: boolean;
}) {
  const work = getHumanScoringWork(input.answers, input.playerId);
  const submissionsReady = input.agreement.activePlayerCount > 0
    && input.agreement.submittedPlayerCount >= input.agreement.activePlayerCount;
  const scoringComplete = submissionsReady && input.agreement.voteCount >= input.agreement.expectedVoteCount;
  const canReview = input.online
    ? Boolean(input.playerId) && submissionsReady && work.pending.length === 0 && !input.busy
    : !input.localPendingScores;
  const canFinish = input.online
    ? canReview && scoringComplete && input.agreement.openDisputeCount === 0
      && input.agreement.isRoundReady && input.mayFinish
    // Preserve the existing local finish contract; no server requirements apply.
    : !input.busy && input.mayFinish && !input.localOpenDisputes;
  return { canReview, canFinish, scoringComplete, submissionsReady, work };
}

/** Shared by alternate navigation controls; recheck eligibility in the handler. */
export function createScoringNavigation(
  policy: Pick<ReturnType<typeof getScoringReadiness>, 'canReview' | 'canFinish'>,
  review: () => void,
  finish: () => void,
) {
  return {
    review: () => { if (policy.canReview) review(); },
    finish: () => { if (policy.canFinish) finish(); },
  };
}

/** Readiness and an expired deadline never prove that the round was persisted as scored. */
export function scoringPhasePresentation(status: string, countdownLabel: string, recordsAgree = true) {
  if (status === 'complete' && !recordsAgree) return {
    label: 'Syncing scoring', detail: 'Waiting for matching answer and vote records. Readiness is not yet confirmed.',
  };
  if (status === 'complete') return {
    label: 'Ready to finish',
    detail: 'Required submissions and votes are recorded, with no open server disputes. Finish still requires server confirmation.',
  };
  if (status === 'expired') return { label: 'Deadline expired', detail: 'Waiting for server processing. An expired deadline does not complete the round.' };
  if (status === 'active') return { label: countdownLabel, detail: 'Server-set deadline. Required work remains until the server records votes or processes the timeout.' };
  if (status === 'error') return { label: 'Sync error', detail: 'Could not sync the latest phase state.' };
  return { label: countdownLabel, detail: 'Waiting for the latest server readiness and deadline.' };
}
