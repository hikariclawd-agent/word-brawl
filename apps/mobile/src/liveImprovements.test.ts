import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSingleFlight, REAL_PLAYER_WAIT_MS, remainingSearchMs } from './liveMatchmaking';
import { choosePersonalityWord, judgeAnswerFromEvidence } from './botStrategy';
import { getCompetitivePlayers } from './onlineRevealRules';
import {
  getCountdownState,
  getDeadlineRemainingSeconds,
  getPhaseDeadline,
  getTimeoutPhase,
  shouldRequestServerTimeout,
} from './timeoutRules';

afterEach(() => vi.useRealTimers());
describe('Live Brawl human search window', () => {
  it('expires at 5000ms, not one tick earlier, independent of round duration', async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const fill = vi.fn();
    setTimeout(fill, remainingSearchMs(0));
    await vi.advanceTimersByTimeAsync(4999);
    expect(fill).not.toHaveBeenCalled();
    expect(remainingSearchMs(0)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fill).toHaveBeenCalledTimes(1);
    expect(REAL_PLAYER_WAIT_MS).toBe(5000);
    expect(remainingSearchMs(0, 5100)).toBe(0);
  });
  it('joins simultaneous calls to a single operation and allows retry', async () => {
    const flight = createSingleFlight();
    let resolve!: (value: number) => void;
    const work = vi.fn(() => new Promise<number>((done) => { resolve = done; }));
    const first = flight(work); const second = flight(work);
    expect(first).toBe(second);
    await Promise.resolve(); expect(work).toHaveBeenCalledTimes(1);
    resolve(4); await first;
    expect(await flight(async () => 5)).toBe(5);
  });
  it('releases failed operation for retry', async () => {
    const flight = createSingleFlight();
    await expect(flight(async () => { throw Error('offline'); })).rejects.toThrow('offline');
    expect(await flight(async () => 'ready')).toBe('ready');
  });
});
describe('personality decisions, not just names', () => {
  const words = ['Ant', 'Ape', 'Alligator', 'Albatross'];
  it('careful and speedy prefer simpler words; scholar prefers longer vocabulary', () => {
    expect(choosePersonalityWord(words, 'Careful', () => 0)).toBe('Ant');
    expect(choosePersonalityWord(words, 'Scholar', () => 0)).toBe('Albatross');
    expect(choosePersonalityWord(words, 'Speedy', () => .99)).toBe('Ape');
  });
  it('chaotic samples the full vocabulary and handles missing letters honestly', () => {
    expect(choosePersonalityWord(words, 'Chaotic', () => 0)).toBe('Ant');
    expect(choosePersonalityWord(words, 'Chaotic', () => .99)).toBe('Albatross');
    expect(choosePersonalityWord([], 'Perfect')).toBe('');
  });
});

describe('online reveal agreement rules', () => {
  it('counts competitive players only, not spectators', () => {
    expect(getCompetitivePlayers([
      { display_name: 'A', id: 'a', role: 'player' },
      { display_name: 'B', id: 'b', role: 'spectator' },
      { display_name: 'C', id: 'c', role: 'player' },
    ]).map((player) => player.id)).toEqual(['a', 'c']);
  });
});

describe('bot scoring evidence', () => {
  it.each([
    ['Classic', 'valid'],
    ['Strict', 'invalid'],
  ] as const)('applies the documented %s wrong-letter policy', (scoringStyle, expectedVerdict) => {
    expect(judgeAnswerFromEvidence({
      answer: 'Antelope',
      difficulty: 'Normal',
      knownInCurrentCategory: true,
      knownInOtherCategory: false,
      letter: 'B',
      scoringStyle,
    })).toBe(expectedVerdict);
  });

  it('keeps a known valid answer valid regardless of strict bot personality', () => {
    expect(judgeAnswerFromEvidence({
      answer: 'Antelope',
      difficulty: 'Hard',
      knownInCurrentCategory: true,
      knownInOtherCategory: false,
      letter: 'A',
      scoringStyle: 'Strict',
    })).toBe('valid');
  });

  it('treats unknown plausible answers as playable instead of randomly invalid', () => {
    expect(judgeAnswerFromEvidence({
      answer: 'Aurelion',
      difficulty: 'Hard',
      knownInCurrentCategory: false,
      knownInOtherCategory: false,
      letter: 'A',
      scoringStyle: 'Classic',
    })).not.toBe('invalid');
  });
});

describe('server timeout decisions', () => {
  it('requests answer finalisation when active players have not all submitted after expiry', () => {
    const phase = getTimeoutPhase({
      activePlayerCount: 2,
      expectedVoteCount: 0,
      openDisputeCount: 0,
      submittedPlayerCount: 1,
      voteCount: 0,
    });

    expect(phase).toBe('answering');
    expect(shouldRequestServerTimeout({
      hasActiveRound: true,
      isOnline: true,
      isRoundBusy: false,
      phase,
      timeRemaining: 0,
    })).toBe(true);
  });

  it('requests scoring finalisation when votes remain after expiry', () => {
    expect(getTimeoutPhase({
      activePlayerCount: 2,
      expectedVoteCount: 2,
      openDisputeCount: 0,
      submittedPlayerCount: 2,
      voteCount: 1,
    })).toBe('scoring');
  });

  it('requests dispute finalisation when open disputes remain after voting', () => {
    expect(getTimeoutPhase({
      activePlayerCount: 2,
      expectedVoteCount: 2,
      openDisputeCount: 1,
      submittedPlayerCount: 2,
      voteCount: 2,
    })).toBe('dispute');
  });

  it('does not request timeout work once the round is complete', () => {
    const phase = getTimeoutPhase({
      activePlayerCount: 2,
      expectedVoteCount: 2,
      openDisputeCount: 0,
      submittedPlayerCount: 2,
      voteCount: 2,
    });

    expect(phase).toBe('complete');
    expect(shouldRequestServerTimeout({
      hasActiveRound: true,
      isOnline: true,
      isRoundBusy: false,
      phase,
      timeRemaining: 0,
    })).toBe(false);
  });

  it('derives countdown states from server-provided deadlines', () => {
    const nowMs = Date.parse('2026-10-11T10:00:00.000Z');
    const futureDeadline = '2026-10-11T10:00:12.000Z';
    const pastDeadline = '2026-10-11T09:59:59.000Z';

    expect(getDeadlineRemainingSeconds(futureDeadline, nowMs)).toBe(12);
    expect(getDeadlineRemainingSeconds(pastDeadline, nowMs)).toBe(0);
    expect(getCountdownState({ deadlineIso: futureDeadline, nowMs })).toEqual({
      label: '12s',
      remainingSeconds: 12,
      status: 'active',
    });
    expect(getCountdownState({ deadlineIso: pastDeadline, nowMs })).toEqual({
      label: 'Expired',
      remainingSeconds: 0,
      status: 'expired',
    });
  });

  it('keeps loading, complete, error, and missing deadline states explicit', () => {
    expect(getCountdownState({ isLoading: true })).toMatchObject({ label: 'Syncing...', status: 'loading' });
    expect(getCountdownState({ phaseComplete: true })).toMatchObject({ label: 'Complete', status: 'complete' });
    expect(getCountdownState({ error: 'offline' })).toMatchObject({ label: 'Sync error', status: 'error' });
    expect(getCountdownState({ deadlineIso: null })).toMatchObject({ label: 'Waiting for server', status: 'unavailable' });
  });

  it('selects the matching server deadline for scoring and dispute phases only', () => {
    const deadlines = {
      disputeEndsAt: '2026-10-11T10:02:00.000Z',
      scoringEndsAt: '2026-10-11T10:01:00.000Z',
    };

    expect(getPhaseDeadline('scoring', deadlines)).toBe(deadlines.scoringEndsAt);
    expect(getPhaseDeadline('dispute', deadlines)).toBe(deadlines.disputeEndsAt);
    expect(getPhaseDeadline('answering', deadlines)).toBeNull();
    expect(getPhaseDeadline('complete', deadlines)).toBeNull();
  });
});
