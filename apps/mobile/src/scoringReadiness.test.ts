import { describe, expect, it, vi } from 'vitest';
import type { OnlineRevealAnswer } from './onlineRooms';
import { createScoringNavigation, getHumanScoringWork, getScoringReadiness, scoringPhasePresentation } from './scoringReadiness';
import { getCountdownState, getTimeoutPhase } from './timeoutRules';

function answer(id: string, owner: string, text = 'Alice', voters: string[] = []): OnlineRevealAnswer {
  return { id, playerId: owner, playerName: owner, answer: text, category: 'Name', points: 10,
    verdict: 'valid', votes: voters.map((voterPlayerId) => ({ voterPlayerId, verdict: 'valid' })) };
}
function input(overrides: Partial<Parameters<typeof getScoringReadiness>[0]> = {}) {
  return { online: true, playerId: 'me', answers: [answer('a', 'other', 'Alice', ['me'])],
    agreement: { activePlayerCount: 2, submittedPlayerCount: 2, voteCount: 2, expectedVoteCount: 2, openDisputeCount: 0, isRoundReady: true },
    busy: false, mayFinish: true, localPendingScores: false, localOpenDisputes: false, ...overrides };
}

describe('online scoring contract', () => {
  it('exposes every nonempty opponent answer, not one assigned opponent', () => {
    const work = getHumanScoringWork([
      answer('self', 'me'), answer('a', 'one'), answer('b', 'two', 'Bob', ['me']),
      answer('c', 'two', 'Cara', ['one']), answer('blank', 'one', ''), answer('space', 'two', '   '),
    ], 'me');
    expect(work.required.map((a) => a.id)).toEqual(['a', 'b', 'c']);
    expect(work.pending.map((a) => a.id)).toEqual(['a', 'c']);
    expect(work.completed).toBe(1);
  });
  it('does not infer a recorded vote from already-awarded points or a verdict', () => {
    const policy = getScoringReadiness(input({ answers: [answer('a', 'other')] }));
    expect(policy.canReview).toBe(false); expect(policy.canFinish).toBe(false);
  });
  it('allows both Review routes only after the current player records all mandatory votes', () => {
    const reviewed = vi.fn(); const finished = vi.fn();
    const blocked = createScoringNavigation(getScoringReadiness(input({ answers: [answer('a', 'other')] })), reviewed, finished);
    // Both controls receive this same guarded handler in App.tsx.
    blocked.review(); blocked.review(); blocked.finish();
    expect(reviewed).not.toHaveBeenCalled(); expect(finished).not.toHaveBeenCalled();
    const ready = createScoringNavigation(getScoringReadiness(input()), reviewed, finished);
    ready.review(); ready.review(); expect(reviewed).toHaveBeenCalledTimes(2);
  });
  it('does not expose review or finish before all humans have submitted', () => {
    const state = input(); state.agreement.submittedPlayerCount = 1;
    expect(getScoringReadiness(state)).toMatchObject({ canReview: false, canFinish: false });
  });
  it('allows Review while waiting for other humans to vote, but blocks both Finish controls', () => {
    const state = input(); state.agreement.voteCount = 1; state.agreement.isRoundReady = false;
    const policy = getScoringReadiness(state);
    expect(policy).toMatchObject({ canReview: true, canFinish: false });
    const finish = vi.fn(); const navigation = createScoringNavigation(policy, vi.fn(), finish);
    navigation.finish(); navigation.finish(); expect(finish).not.toHaveBeenCalled();
  });
  it('allows Review with open server disputes and unlocks Finish only after resolution', () => {
    const state = input(); state.agreement.openDisputeCount = 1; state.agreement.isRoundReady = false;
    expect(getScoringReadiness(state)).toMatchObject({ canReview: true, canFinish: false });
    state.agreement.openDisputeCount = 0; state.agreement.isRoundReady = true;
    const finish = vi.fn(); const navigation = createScoringNavigation(getScoringReadiness(state), vi.fn(), finish);
    navigation.finish(); navigation.finish(); expect(finish).toHaveBeenCalledTimes(2);
  });
  it('requires no manual public CPU scoring in a solo-human auto-scored round', () => {
    // CPUs live in bot snapshots, not the human answer/vote collection.
    const state = input({ answers: [answer('self', 'me')], localPendingScores: true, localOpenDisputes: true,
      agreement: { activePlayerCount: 1, submittedPlayerCount: 1, expectedVoteCount: 0, voteCount: 0, openDisputeCount: 0, isRoundReady: true } });
    expect(getScoringReadiness(state)).toMatchObject({ canReview: true, canFinish: true, work: { required: [], pending: [] } });
  });
  it.each([{ busy: true }, { mayFinish: false }, { playerId: undefined }])('respects completion eligibility %j', (override) => {
    expect(getScoringReadiness(input(override)).canFinish).toBe(false);
  });
  it('does not substitute client task completion for server readiness', () => {
    const state = input(); state.agreement.isRoundReady = false;
    expect(getScoringReadiness(state)).toMatchObject({ canReview: true, canFinish: false });
  });
  it('keeps unknown initial readiness blocked', () => {
    const state = input({ answers: [], agreement: { activePlayerCount: 0, submittedPlayerCount: 0, expectedVoteCount: 0, voteCount: 0, openDisputeCount: 0, isRoundReady: false } });
    expect(getScoringReadiness(state)).toMatchObject({ canReview: false, canFinish: false });
  });
});

describe('phase wording is not persisted round status', () => {
  it('labels completed voting requirements Ready to finish, not scored', () => {
    const state = input();
    expect(getTimeoutPhase(state.agreement)).toBe('complete');
    const countdown = getCountdownState({ phaseComplete: true });
    const copy = scoringPhasePresentation(countdown.status, countdown.label);
    expect(copy.label).toBe('Ready to finish');
    expect(copy.detail).toContain('requires server confirmation');
    expect(copy.detail).not.toContain('round is scored');
  });
  it('does not equate expired deadlines with readiness', () => {
    const countdown = getCountdownState({ deadlineIso: '2026-10-15T00:00:00Z', nowMs: Date.parse('2026-10-16T00:00:00Z') });
    expect(scoringPhasePresentation(countdown.status, countdown.label)).toMatchObject({ label: 'Deadline expired' });
    const state = input(); state.agreement.voteCount = 0; state.agreement.isRoundReady = false;
    expect(getScoringReadiness(state).canFinish).toBe(false);
  });
  it('shows syncing instead of contradictory readiness while detailed votes lag', () => {
    expect(scoringPhasePresentation('complete', 'Complete', false).label).toBe('Syncing scoring');
  });
  it.each(['loading', 'unavailable', 'error'])('does not claim readiness for %s', (status) => {
    expect(scoringPhasePresentation(status, 'Waiting').label).not.toBe('Ready to finish');
  });
});

describe('offline/practice rules', () => {
  it('retains existing local mandatory review scoring', () => {
    expect(getScoringReadiness(input({ online: false, localPendingScores: true })).canReview).toBe(false);
    expect(getScoringReadiness(input({ online: false, localPendingScores: false })).canReview).toBe(true);
  });
  it('does not require server submissions, votes or readiness offline', () => {
    const state = input({ online: false, answers: [], playerId: undefined });
    state.agreement.activePlayerCount = 0; state.agreement.isRoundReady = false;
    expect(getScoringReadiness(state)).toMatchObject({ canReview: true, canFinish: true });
  });
  it('retains local dispute and busy completion gates', () => {
    expect(getScoringReadiness(input({ online: false, localOpenDisputes: true })).canFinish).toBe(false);
    expect(getScoringReadiness(input({ online: false, busy: true })).canFinish).toBe(false);
  });
});
