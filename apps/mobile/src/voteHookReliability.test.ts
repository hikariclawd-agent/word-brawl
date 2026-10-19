import { beforeEach, describe, expect, it, vi } from 'vitest';
// Minimal state/ref renderer: exercise the real hook's actions and explicitly
// run its round-sync effects, without mounting native UI or startup storage.
const hooks = vi.hoisted(() => ({
  slots: [] as unknown[], cursor: 0,
  effects: [] as Array<{ run: () => void | (() => void); deps?: readonly unknown[] }>,
}));
vi.mock('react', () => ({
  useState(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks.slots[index], (next: unknown) => {
      hooks.slots[index] = typeof next === 'function' ? next(hooks.slots[index]) : next;
    }];
  },
  useRef(initial: unknown) {
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = { current: initial };
    return hooks.slots[index];
  },
  useMemo: (factory: () => unknown) => factory(),
  useEffect: (run: () => void | (() => void), deps?: readonly unknown[]) => hooks.effects.push({ run, deps }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { setItem: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('./onlineRooms', () => ({
  createOnlineRoom: vi.fn(), joinOnlineRoom: vi.fn(), startOnlineRound: vi.fn(), persistOnlineAnswerVoteById: vi.fn(),
  submitOnlineAnswers: vi.fn(),
  completeOnlineRound: vi.fn(), finalizeOnlineRoundTimeout: vi.fn(),
  openOnlineAnswerDispute: vi.fn(), persistOnlineDisputeVote: vi.fn(), getOnlineRevealSnapshot: vi.fn(),
  getOnlineBotRoundSnapshot: vi.fn(), leaveOnlineRoom: vi.fn(),
  getOnlineRoomSnapshot: vi.fn(), getOnlinePlayerAnswers: vi.fn(), getOnlineMatchStandings: vi.fn(), getOnlinePlayerRoundHistory: vi.fn(),
}));
vi.mock('./devDiagnostics', () => ({ debugGameEvent: vi.fn(), debugGameError: vi.fn() }));
vi.mock('./qaTelemetry', () => ({ emitQaTelemetry: vi.fn() }));
import * as online from './onlineRooms';
import { useLocalGame } from './useLocalGame';
import { VoteCommandError, withVoteAcknowledgement, type VoteReceipt } from './voteCommands';
let game: ReturnType<typeof useLocalGame>;
const answer: online.OnlineRevealAnswer = {
  id: 'answer', playerId: 'other', playerName: 'Other', answer: 'Alice', category: 'Name', points: 0, verdict: 'blank', votes: [],
};
function render() { hooks.cursor = 0; hooks.effects = []; game = useLocalGame(); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function nextTick() { return new Promise<void>((resolve) => setImmediate(resolve)); }
function makeRevealSnapshot(nextAnswer: online.OnlineRevealAnswer = answer, overrides: Partial<online.OnlineRevealSnapshot> = {}): online.OnlineRevealSnapshot {
  return {
    activePlayerCount: 2, submittedPlayerCount: 1, answers: [nextAnswer], scores: [],
    expectedVoteCount: 1, voteCount: 0, openDisputeCount: 0, isRoundReady: false,
    pendingDisputeVoterNames: [], pendingSubmitterNames: ['Other'], pendingVoterNames: [],
    ...overrides,
  };
}
function startRevealPoll() {
  const revealEffect = hooks.effects
    .filter(({ deps }) => deps?.length === 4
      && deps[0] === game.currentRound?.id
      && deps[1] === game.room?.id
      && deps[2] === true
      && deps[3] === 'reveal')
    .at(-1);
  expect(revealEffect).toBeDefined();
  return revealEffect!.run();
}
async function startExpiredTimeoutFinalization() {
  game.setScreen('reveal');
  render();
  vi.mocked(online.getOnlineRevealSnapshot).mockResolvedValueOnce(makeRevealSnapshot(answer, {
    isRoundReady: false,
    scoringEndsAt: '2020-01-01T00:00:00.000Z',
  }));
  startRevealPoll();
  await nextTick();
  render();
  game.updateVerdict('Name', 'valid');
  await nextTick();
  expect(online.finalizeOnlineRoundTimeout).toHaveBeenCalled();
}
function startRoomPoll(screen: 'leaderboard' | 'lobby' = 'leaderboard') {
  const roomEffect = hooks.effects
    .filter(({ deps }) => deps?.length === 4
      && deps[1] === 'room'
      && deps[2] === true
      && deps[3] === screen)
    .at(-1);
  expect(roomEffect).toBeDefined();
  return roomEffect!.run();
}
beforeEach(async () => {
  vi.clearAllMocks(); hooks.slots = []; render();
  vi.mocked(online.createOnlineRoom).mockResolvedValue({
    id: 'room', code: 'ABC123', playerId: 'human', playerName: 'Human', playerNames: ['Human', 'Other'],
    hostName: 'Human', isHost: true, playerCount: 2, spectatorCount: 0, expiresAt: '',
    settings: { activeModeLabel: 'Live', activeModeRules: '', botCount: 0, botDifficulty: 'Normal', categories: ['Name'], roundSeconds: 60, scoringOwner: 'Opponents', scoringStyle: 'Classic', targetRounds: 3 },
    setupLocked: true, status: 'lobby', visibility: 'public',
  });
  await game.createRoom(); render();
  vi.mocked(online.startOnlineRound).mockResolvedValue({ id: 'round', letter: 'A', roundNumber: 1 });
  await game.startRound(); render();
  vi.mocked(online.submitOnlineAnswers).mockResolvedValue({ answeredCount: 1, score: 0 });
  vi.mocked(online.finalizeOnlineRoundTimeout).mockResolvedValue({
    accepted: true, duplicate: false, phase: 'answering', revision: 1, round_id: 'round',
  });
  vi.mocked(online.getOnlineRevealSnapshot).mockResolvedValue({
    activePlayerCount: 2, submittedPlayerCount: 2, answers: [], scores: [], expectedVoteCount: 0,
    voteCount: 0, openDisputeCount: 0, isRoundReady: true,
    pendingDisputeVoterNames: [], pendingSubmitterNames: [], pendingVoterNames: [],
  });
  vi.mocked(online.getOnlineMatchStandings).mockResolvedValue([]);
  vi.mocked(online.getOnlinePlayerRoundHistory).mockResolvedValue([]);
  vi.mocked(online.leaveOnlineRoom).mockResolvedValue(undefined);
});

describe('Play Again match boundary', () => {
  it('does not commit a delayed round start after reset creates room B', async () => {
    const delayedRound = deferred<online.OnlineRoundResult>();
    vi.mocked(online.startOnlineRound).mockReturnValue(delayedRound.promise);

    const starting = game.startRound();
    await nextTick();

    vi.mocked(online.createOnlineRoom).mockResolvedValue({
      id: 'room-b', code: 'ROOMB', playerId: 'human-b', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Human', isHost: true, playerCount: 1, spectatorCount: 0, expiresAt: '',
      settings: game.room!.settings, setupLocked: false, status: 'lobby', visibility: 'public',
    });
    await game.resetMatch(); render();

    delayedRound.resolve({ id: 'old-round', letter: 'Z', roundNumber: 99 });
    await starting;
    render();

    expect(game.room).toMatchObject({ id: 'room-b', code: 'ROOMB' });
    expect(game.currentRound).toBeNull();
    expect(game.screen).toBe('lobby');
    expect(game.roomError).toBe('');
  });

  it('starts room B with preserved settings and rejects a delayed room-A snapshot', async () => {
    for (const category of ['Animal', 'Food', 'Object', 'Job', 'Brand'] as const) {
      game.toggleSelectedCategory(category);
    }
    game.setTargetRounds(5, false);
    game.setRoundSeconds(75, false);
    game.setScreen('leaderboard');
    render();

    const delayedRoomASnapshot = deferred<online.OnlineRoomSnapshot>();
    vi.mocked(online.getOnlineRoomSnapshot).mockImplementation((roomId) => (
      roomId === 'room'
        ? delayedRoomASnapshot.promise
        : Promise.resolve({
          activeRound: null,
          expiresAt: '',
          hostName: 'Human',
          hostPlayerId: 'human',
          isExpired: false,
          playerCount: 1,
          playerNames: ['Human'],
          settings: {
            activeModeLabel: 'Preserved', activeModeRules: '', botCount: 0, botDifficulty: 'Normal',
            categories: ['Name', 'Place'], roundSeconds: 75, scoringOwner: 'Opponents',
            scoringStyle: 'Classic', targetRounds: 5,
          },
          setupLocked: false,
          status: 'lobby',
          spectatorCount: 0,
          visibility: 'public',
        })
    ));
    startRoomPoll();

    vi.mocked(online.createOnlineRoom).mockResolvedValue({
      id: 'room-b', code: 'ROOMB', playerId: 'human-b', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Human', isHost: true, playerCount: 1, spectatorCount: 0, expiresAt: '',
      settings: {
        activeModeLabel: 'Preserved', activeModeRules: '', botCount: 0, botDifficulty: 'Normal',
        categories: ['Name', 'Place'], roundSeconds: 75, scoringOwner: 'Opponents',
        scoringStyle: 'Classic', targetRounds: 5,
      },
      setupLocked: false, status: 'lobby', visibility: 'public',
    });

    await game.resetMatch();
    render();

    expect(game.room).toMatchObject({ id: 'room-b', code: 'ROOMB', status: 'lobby' });
    expect(game.selectedCategories).toEqual(['Name', 'Place']);
    expect(game.targetRounds).toBe(5);
    expect(game.roundSeconds).toBe(75);
    expect(game.currentRound).toBeNull();
    expect(game.roundHistory).toEqual([]);
    expect(game.onlineRevealAnswers).toEqual([]);
    expect(game.onlineMatchStandings).toEqual([]);
    expect(game.lastMatchResult).toBeNull();
    expect(game.matchResetToken).toBe(1);

    delayedRoomASnapshot.resolve({
      activeRound: { id: 'old-round', letter: 'Z', roundNumber: 99, status: 'active' },
      expiresAt: 'old', hostName: 'Old host', hostPlayerId: 'old-player', isExpired: false,
      playerCount: 2, playerNames: ['Old'], settings: {
        activeModeLabel: 'Old match', activeModeRules: '', botCount: 1, botDifficulty: 'Hard',
        categories: ['Animal'], roundSeconds: 30, scoringOwner: 'Self', scoringStyle: 'Strict', targetRounds: 1,
      }, setupLocked: true, status: 'in_round', spectatorCount: 1, visibility: 'private',
    });
    await nextTick();
    render();

    expect(game.room).toMatchObject({ id: 'room-b', code: 'ROOMB', status: 'lobby' });
    expect(game.selectedCategories).toEqual(['Name', 'Place']);
    expect(game.targetRounds).toBe(5);
    expect(game.roundSeconds).toBe(75);
    expect(game.currentRound).toBeNull();
    expect(game.roundHistory).toEqual([]);
    expect(game.onlineRevealAnswers).toEqual([]);
    expect(game.onlineMatchStandings).toEqual([]);
    expect(game.lastMatchResult).toBeNull();
  });

  it('does not create overlapping replacement rooms when reset is invoked twice', async () => {
    const leaveStarted = deferred<void>();
    vi.mocked(online.leaveOnlineRoom).mockReturnValueOnce(leaveStarted.promise);
    vi.mocked(online.createOnlineRoom).mockClear();
    vi.mocked(online.createOnlineRoom).mockResolvedValue({
      id: 'room-b', code: 'ROOMB', playerId: 'human-b', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Human', isHost: true, playerCount: 1, spectatorCount: 0, expiresAt: '',
      settings: { activeModeLabel: 'Live', activeModeRules: '', botCount: 0, botDifficulty: 'Normal', categories: ['Name'], roundSeconds: 60, scoringOwner: 'Opponents', scoringStyle: 'Classic', targetRounds: 3 },
      setupLocked: false, status: 'lobby', visibility: 'public',
    });

    const firstReset = game.resetMatch();
    const secondReset = game.resetMatch();
    leaveStarted.resolve();
    await Promise.all([firstReset, secondReset]);

    expect(online.createOnlineRoom).toHaveBeenCalledOnce();
  });
});

describe('join interruption safety', () => {
  it('does not hydrate a joined room after another room becomes active', async () => {
    const roomSettings = game.room!.settings;
    await game.leaveRoom();
    render();
    game.setRoomCodeInput('JOINME');
    render();

    const restoredAnswers = deferred<Record<string, string>>();
    vi.mocked(online.joinOnlineRoom).mockResolvedValue({
      id: 'joined-room', code: 'JOINME', playerId: 'joined-human', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Other', isHost: false, playerCount: 2, spectatorCount: 0, expiresAt: '',
      settings: roomSettings, setupLocked: true, status: 'in_round', visibility: 'public',
    });
    vi.mocked(online.getOnlineRoomSnapshot).mockResolvedValue({
      activeRound: { id: 'joined-round', letter: 'A', roundNumber: 1, status: 'active' },
      expiresAt: '', hostName: 'Other', hostPlayerId: 'other', isExpired: false,
      playerCount: 2, playerNames: ['Other', 'Human'], settings: roomSettings,
      setupLocked: true, status: 'in_round', spectatorCount: 0, visibility: 'public',
    });
    vi.mocked(online.getOnlinePlayerAnswers).mockReturnValue(restoredAnswers.promise);

    const joining = game.joinRoom();
    await nextTick();

    vi.mocked(online.createOnlineRoom).mockResolvedValue({
      id: 'room-b', code: 'ROOMB', playerId: 'human-b', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Human', isHost: true, playerCount: 1, spectatorCount: 0, expiresAt: '',
      settings: roomSettings, setupLocked: false, status: 'lobby', visibility: 'public',
    });
    await game.createRoom(); render();

    restoredAnswers.resolve({ Name: 'Stale answer' });
    await joining;
    render();

    expect(game.room).toMatchObject({ id: 'room-b', code: 'ROOMB' });
    expect(game.currentRound).toBeNull();
    expect(game.screen).toBe('lobby');
    expect(game.roomError).toBe('');
  });
});

describe('answer submission context safety', () => {
  it('does not commit a delayed submission after leaving the room', async () => {
    const delayedSubmission = deferred<online.OnlineAnswerSubmitResult>();
    vi.mocked(online.submitOnlineAnswers).mockReturnValueOnce(delayedSubmission.promise);

    const submitting = game.submitAnswers();
    await nextTick();

    const leaving = game.leaveRoom();
    delayedSubmission.resolve({ answeredCount: 1, score: 0 });
    await leaving;
    await submitting;
    render();

    expect(game.room).toBeNull();
    expect(game.currentRound).toBeNull();
    expect(game.roundSubmitted).toBe(false);
    expect(game.botRoundAnswers).toEqual([]);
    expect(game.screen).toBe('home');
    expect(game.roomError).toBe('');
  });

  it('does not let an old submission clear a newer round busy state', async () => {
    const delayedSubmission = deferred<online.OnlineAnswerSubmitResult>();
    vi.mocked(online.submitOnlineAnswers).mockReturnValueOnce(delayedSubmission.promise);
    const roomSettings = game.room!.settings;
    vi.mocked(online.createOnlineRoom).mockResolvedValue({
      id: 'room-b', code: 'ROOMB', playerId: 'human-b', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Human', isHost: true, playerCount: 1, spectatorCount: 0, expiresAt: '',
      settings: roomSettings, setupLocked: false, status: 'lobby', visibility: 'public',
    });

    const submitting = game.submitAnswers();
    await nextTick();
    await game.resetMatch();
    render();

    const delayedRound = deferred<online.OnlineRoundResult>();
    vi.mocked(online.startOnlineRound).mockReturnValueOnce(delayedRound.promise);
    expect(game.room).toMatchObject({ id: 'room-b', isOnline: true });
    const starting = game.startRound();
    await nextTick();
    render();
    expect(game.isRoundBusy).toBe(true);

    delayedSubmission.resolve({ answeredCount: 1, score: 0 });
    await submitting;
    render();
    expect(game.isRoundBusy).toBe(true);

    delayedRound.resolve({ id: 'round-b-1', letter: 'B', roundNumber: 1 });
    await starting;
    render();
    expect(game.isRoundBusy).toBe(false);
  });
});

describe('timeout finalisation context safety', () => {
  it('does not set a stale timeout error after resetting into a new room', async () => {
    const delayedTimeout = deferred<{
      accepted: boolean;
      duplicate: boolean;
      phase: 'answering';
      revision: number;
      round_id: string;
    }>();
    vi.mocked(online.finalizeOnlineRoundTimeout).mockReturnValueOnce(delayedTimeout.promise);
    const roomSettings = game.room!.settings;
    vi.mocked(online.createOnlineRoom).mockResolvedValue({
      id: 'room-b', code: 'ROOMB', playerId: 'human-b', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Human', isHost: true, playerCount: 1, spectatorCount: 0, expiresAt: '',
      settings: roomSettings, setupLocked: false, status: 'lobby', visibility: 'public',
    });

    await startExpiredTimeoutFinalization();
    expect(online.finalizeOnlineRoundTimeout).toHaveBeenCalledOnce();
    const resetting = game.resetMatch();
    delayedTimeout.reject(new Error('old room timeout failed'));
    await resetting;
    render();

    await nextTick();
    render();

    expect(game.room).toMatchObject({ id: 'room-b', code: 'ROOMB' });
    expect(game.roomError).toBe('');
  });

  it('does not commit a stale timeout result after resetting into a new room', async () => {
    const delayedTimeout = deferred<{
      accepted: boolean;
      duplicate: boolean;
      phase: 'answering';
      revision: number;
      round_id: string;
    }>();
    vi.mocked(online.finalizeOnlineRoundTimeout).mockReturnValueOnce(delayedTimeout.promise);
    const roomSettings = game.room!.settings;
    vi.mocked(online.createOnlineRoom).mockResolvedValue({
      id: 'room-b', code: 'ROOMB', playerId: 'human-b', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Human', isHost: true, playerCount: 1, spectatorCount: 0, expiresAt: '',
      settings: roomSettings, setupLocked: false, status: 'lobby', visibility: 'public',
    });

    await startExpiredTimeoutFinalization();
    const snapshotCallsBeforeReset = vi.mocked(online.getOnlineRevealSnapshot).mock.calls.length;
    const resetting = game.resetMatch();
    delayedTimeout.resolve({ accepted: true, duplicate: false, phase: 'answering', revision: 2, round_id: 'round' });
    await nextTick();
    expect(vi.mocked(online.getOnlineRevealSnapshot).mock.calls.length).toBe(snapshotCallsBeforeReset);
    await resetting;
    render();

    await nextTick();
    render();

    expect(game.room).toMatchObject({ id: 'room-b', code: 'ROOMB' });
    expect(game.currentRound).toBeNull();
    expect(game.roundSubmitted).toBe(false);
    expect(game.screen).toBe('lobby');
    expect(game.roomError).toBe('');
  });

  it('does not let an old timeout clear a newer round busy state', async () => {
    const delayedTimeout = deferred<{
      accepted: boolean;
      duplicate: boolean;
      phase: 'answering';
      revision: number;
      round_id: string;
    }>();
    vi.mocked(online.finalizeOnlineRoundTimeout).mockReturnValueOnce(delayedTimeout.promise);
    const roomSettings = game.room!.settings;
    vi.mocked(online.createOnlineRoom).mockResolvedValue({
      id: 'room-b', code: 'ROOMB', playerId: 'human-b', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Human', isHost: true, playerCount: 1, spectatorCount: 0, expiresAt: '',
      settings: roomSettings, setupLocked: false, status: 'lobby', visibility: 'public',
    });

    await startExpiredTimeoutFinalization();
    await game.resetMatch();
    render();

    const delayedRound = deferred<online.OnlineRoundResult>();
    vi.mocked(online.startOnlineRound).mockReturnValueOnce(delayedRound.promise);
    const starting = game.startRound();
    await nextTick();
    render();
    expect(game.isRoundBusy).toBe(true);

    delayedTimeout.resolve({ accepted: true, duplicate: false, phase: 'answering', revision: 2, round_id: 'round' });
    await nextTick();
    render();
    expect(game.isRoundBusy).toBe(true);

    delayedRound.resolve({ id: 'round-b-1', letter: 'B', roundNumber: 1 });
    await starting;
    render();
    expect(game.isRoundBusy).toBe(false);
  });

  it('invalidates timeout ownership when startRound begins in the same match', async () => {
    const delayedTimeout = deferred<{
      accepted: boolean;
      duplicate: boolean;
      phase: 'answering';
      revision: number;
      round_id: string;
    }>();
    vi.mocked(online.finalizeOnlineRoundTimeout).mockReturnValueOnce(delayedTimeout.promise);

    await startExpiredTimeoutFinalization();

    const delayedRound = deferred<online.OnlineRoundResult>();
    vi.mocked(online.startOnlineRound).mockReturnValueOnce(delayedRound.promise);
    const starting = game.startRound();
    await nextTick();
    render();
    expect(game.isRoundBusy).toBe(true);

    delayedTimeout.resolve({ accepted: true, duplicate: false, phase: 'answering', revision: 2, round_id: 'round' });
    await nextTick();
    render();
    expect(game.isRoundBusy).toBe(true);

    delayedRound.resolve({ id: 'round-2', letter: 'B', roundNumber: 2 });
    await starting;
    render();
    expect(game.isRoundBusy).toBe(false);
  });

  it('coalesces same-match timeout calls but not a new generation', async () => {
    const delayedTimeout = deferred<{
      accepted: boolean;
      duplicate: boolean;
      phase: 'answering';
      revision: number;
      round_id: string;
    }>();
    vi.mocked(online.finalizeOnlineRoundTimeout).mockReturnValueOnce(delayedTimeout.promise);
    const roomSettings = game.room!.settings;
    vi.mocked(online.createOnlineRoom).mockResolvedValue({
      id: 'room-b', code: 'ROOMB', playerId: 'human-b', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Human', isHost: true, playerCount: 1, spectatorCount: 0, expiresAt: '',
      settings: roomSettings, setupLocked: false, status: 'lobby', visibility: 'public',
    });

    await startExpiredTimeoutFinalization();
    game.updateVerdict('Name', 'valid');
    expect(online.finalizeOnlineRoundTimeout).toHaveBeenCalledOnce();

    await game.resetMatch();
    render();
    delayedTimeout.resolve({ accepted: true, duplicate: false, phase: 'answering', revision: 2, round_id: 'round' });
    await nextTick();

    await game.startRound();
    render();
    expect(game.currentRound).toMatchObject({ id: 'round' });
    await startExpiredTimeoutFinalization();
    expect(online.finalizeOnlineRoundTimeout).toHaveBeenCalledTimes(2);
  });
});

describe('authoritative match-state freshness', () => {
  it('does not hydrate a delayed room-A round into a replacement room', async () => {
    const restoredAnswers = deferred<Record<string, string>>();
    const roomA = game.room!;
    game.setScreen('lobby');
    render();
    vi.mocked(online.getOnlineRoomSnapshot).mockResolvedValue({
      activeRound: { id: 'room-a-round', letter: 'A', roundNumber: 1, status: 'active' },
      expiresAt: '', hostName: 'Human', hostPlayerId: 'human', isExpired: false,
      playerCount: 1, playerNames: ['Human'], settings: roomA.settings,
      setupLocked: true, status: 'in_round', spectatorCount: 0, visibility: 'public',
    });
    vi.mocked(online.getOnlinePlayerAnswers).mockReturnValue(restoredAnswers.promise);

    const poll = startRoomPoll('lobby');
    await nextTick();

    vi.mocked(online.createOnlineRoom).mockResolvedValue({
      id: 'room-b', code: 'ROOMB', playerId: 'human-b', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Human', isHost: true, playerCount: 1, spectatorCount: 0, expiresAt: '',
      settings: roomA.settings, setupLocked: false, status: 'lobby', visibility: 'public',
    });
    await game.resetMatch();
    render();

    restoredAnswers.resolve({ Name: 'Alice' });
    await nextTick();
    render();
    poll?.();

    expect(game.room).toMatchObject({ id: 'room-b', code: 'ROOMB' });
    expect(game.currentRound).toBeNull();
    expect(game.answers).toEqual({ Name: '', Place: '', Animal: '', Food: '', Object: '', Job: '', Brand: '' });
    expect(game.onlineMatchStandings).toEqual([]);
    expect(game.screen).toBe('lobby');
    expect(game.roomError).toBe('');
  });

  it('does not commit room-poll standings or stale errors after leaving the room', async () => {
    game.setScreen('leaderboard'); render();
    let rejectStandings!: (reason: unknown) => void;
    const standings = new Promise<online.OnlineMatchStanding[]>((_, reject) => { rejectStandings = reject; });
    const history = deferred<online.OnlinePlayerRoundSummary[]>();
    vi.mocked(online.getOnlineRoomSnapshot).mockResolvedValue({
      activeRound: null, expiresAt: '', hostName: 'Human', hostPlayerId: 'human', isExpired: false,
      playerCount: 2, playerNames: ['Human', 'Other'], settings: game.room!.settings,
      setupLocked: true, status: 'finished', spectatorCount: 0, visibility: 'public',
    });
    vi.mocked(online.getOnlineMatchStandings).mockImplementationOnce(() => standings);
    vi.mocked(online.getOnlinePlayerRoundHistory).mockImplementationOnce(() => history.promise);
    const poll = startRoomPoll('leaderboard');
    await nextTick();

    const leaving = game.leaveRoom();
    await leaving;
    render();
    rejectStandings(new Error('old match state failed'));
    history.resolve([]);
    await nextTick();
    render();
    poll?.();

    expect(game.screen).toBe('home');
    expect(game.lastMatchResult).toBeNull();
    expect(game.roundHistory).toEqual([]);
    expect(game.roomError).toBe('');
  });

  it('does not commit round-completion state or errors after the round boundary changes', async () => {
    const history = deferred<online.OnlinePlayerRoundSummary[]>();
    let rejectStandings!: (reason: unknown) => void;
    const standingsPromise = new Promise<online.OnlineMatchStanding[]>((_, reject) => { rejectStandings = reject; });
    vi.mocked(online.getOnlineBotRoundSnapshot).mockResolvedValue({ roomId: 'room', roundId: 'round', bots: [] });
    vi.mocked(online.completeOnlineRound).mockResolvedValue(undefined);
    vi.mocked(online.getOnlineMatchStandings).mockReturnValue(standingsPromise);
    vi.mocked(online.getOnlinePlayerRoundHistory).mockReturnValue(history.promise);

    const finishing = game.finishRound();
    await nextTick();
    const leaving = game.leaveRoom();
    await leaving;
    render();
    rejectStandings(new Error('old completion state failed'));
    history.resolve([]);
    await finishing;
    await nextTick();
    render();

    expect(game.screen).toBe('home');
    expect(game.lastMatchResult).toBeNull();
    expect(game.roundHistory).toEqual([]);
    expect(game.roomError).toBe('');
  });
});

describe('hook/UI acknowledgement contract', () => {
  it.each([
    ['valid', 10, 10, 'invalid'],
    ['variant', 0, 0, 'valid'],
    ['valid', 13, 13, 'valid'],
  ] as const)('uses the authoritative %s round score (%i), independent of local verdict scoring', async (verdict, points, serverScore, localVerdict) => {
    game.updateVerdict('Name', localVerdict);
    render();
    expect(game.totalScore).toBe(0);

    vi.mocked(online.persistOnlineDisputeVote).mockResolvedValue({ accepted: true, resolved: true, finalVerdict: verdict });
    vi.mocked(online.getOnlineRevealSnapshot).mockResolvedValue(makeRevealSnapshot({
      ...answer,
      playerId: 'human',
      points,
      verdict,
    }, {
      scores: [{ answeredCount: 1, playerId: 'human', playerName: 'Human', score: serverScore }],
    }));

    expect(await game.persistSyncedDisputeVote(`dispute-${verdict}-${points}`, verdict)).toMatchObject({ accepted: true, resolved: true });
    render();

    expect(game.onlineRevealAnswers[0]).toMatchObject({ playerId: 'human', points, verdict });
    expect(game.onlineRoundScores).toEqual([{ answeredCount: 1, playerId: 'human', playerName: 'Human', score: serverScore }]);
    expect(game.totalScore).toBe(serverScore);
  });

  it('preserves locally calculated totals outside online rooms', async () => {
    await game.leaveRoom();
    render();
    game.updateVerdict('Name', 'valid');
    render();
    expect(game.totalScore).toBe(10);
  });

  it('blocks ordinary own-answer scoring without changing verdicts or confirming success', async () => {
    const before = game.verdicts;
    const confirmed = vi.fn();
    const result = await withVoteAcknowledgement(() => game.persistCategoryVote('Name', 'valid', 'valid'), confirmed);
    render();
    expect(result).toMatchObject({ accepted: false, error: { outcome: 'rejected' } });
    expect(game.verdicts).toEqual(before); expect(confirmed).not.toHaveBeenCalled();
    expect(game.roomError).toContain('cannot score your own');
    expect(online.persistOnlineAnswerVoteById).not.toHaveBeenCalled();
  });
  it('waits for legitimate vote acknowledgement before confirmed feedback', async () => {
    let resolve!: (receipt: VoteReceipt) => void;
    vi.mocked(online.persistOnlineAnswerVoteById).mockReturnValue(new Promise((done) => { resolve = done; }));
    const confirmed = vi.fn();
    const result = withVoteAcknowledgement(() => game.persistSyncedAnswerVote(answer, 'valid', 'valid'), confirmed);
    expect(confirmed).not.toHaveBeenCalled();
    resolve({ accepted: true, revision: 1, commandId: 'command', duplicate: false, resolved: false, finalVerdict: undefined });
    await result; expect(confirmed).toHaveBeenCalledOnce();
  });
  it('refreshes authoritative verdict and score state after an accepted ordinary answer vote', async () => {
    const resolvedAnswer = { ...answer, points: 10, verdict: 'valid' as const };
    vi.mocked(online.persistOnlineAnswerVoteById).mockResolvedValue({
      accepted: true, commandId: 'command', duplicate: false, revision: 2,
    });
    vi.mocked(online.getOnlineRevealSnapshot).mockResolvedValue(makeRevealSnapshot(resolvedAnswer, {
      scores: [{ answeredCount: 1, playerId: 'other', playerName: 'Other', score: 10 }],
      submittedPlayerCount: 2,
      voteCount: 2,
      isRoundReady: true,
    }));
    vi.mocked(online.getOnlineMatchStandings).mockResolvedValue([
      { playerId: 'human', playerName: 'Human', totalScore: 10, lastRoundScore: 10, roundsPlayed: 1 },
    ]);
    vi.mocked(online.getOnlinePlayerRoundHistory).mockResolvedValue([
      { roundId: 'round', roundNumber: 1, letter: 'A', answeredCount: 1, score: 10 },
    ]);

    const result = await game.persistSyncedAnswerVote(answer, 'valid', 'valid');
    render();

    expect(result).toMatchObject({ accepted: true, revision: 2 });
    expect(game.onlineRevealAnswers).toEqual([resolvedAnswer]);
    expect(game.onlineRoundScores).toEqual([
      { answeredCount: 1, playerId: 'other', playerName: 'Other', score: 10 },
    ]);
    expect(game.onlineMatchStandings).toEqual([
      { playerId: 'human', playerName: 'Human', totalScore: 10, lastRoundScore: 10, roundsPlayed: 1 },
    ]);
    expect(game.onlinePlayerRoundHistory).toEqual([
      { roundId: 'round', roundNumber: 1, letter: 'A', answeredCount: 1, score: 10 },
    ]);
    expect(game.onlineAnswerVoteRefreshWarning).toBeNull();
  });
  it('preserves an accepted ordinary vote and exposes a refresh warning without resubmitting', async () => {
    vi.mocked(online.persistOnlineAnswerVoteById).mockResolvedValue({
      accepted: true, commandId: 'command', duplicate: false, revision: 2,
    });
    vi.mocked(online.getOnlineRevealSnapshot).mockRejectedValue(new Error('Refresh unavailable'));

    const result = await game.persistSyncedAnswerVote(answer, 'valid', 'valid');
    render();

    expect(result).toMatchObject({ accepted: true, refreshWarning: { stage: 'refresh', message: 'Refresh unavailable' } });
    expect(game.onlineAnswerVoteRefreshWarning).toBe('Refresh unavailable');
    expect(online.persistOnlineAnswerVoteById).toHaveBeenCalledOnce();
  });
  it('clears an ordinary-vote refresh warning after a later successful refresh', async () => {
    vi.mocked(online.persistOnlineAnswerVoteById).mockResolvedValue({
      accepted: true, commandId: 'command', duplicate: false, revision: 2,
    });
    vi.mocked(online.getOnlineRevealSnapshot).mockRejectedValueOnce(new Error('Refresh unavailable'));
    await game.persistSyncedAnswerVote(answer, 'valid', 'valid');
    render();
    expect(game.onlineAnswerVoteRefreshWarning).toBe('Refresh unavailable');

    game.setScreen('reveal');
    render();
    vi.mocked(online.getOnlineRevealSnapshot).mockResolvedValue(makeRevealSnapshot({ ...answer, verdict: 'valid', points: 10 }));
    const cleanup = startRevealPoll();
    await nextTick();
    render();
    cleanup?.();

    expect(game.onlineAnswerVoteRefreshWarning).toBeNull();
  });
  it('returns structured rejection without confirmed UI feedback', async () => {
    vi.mocked(online.persistOnlineAnswerVoteById).mockRejectedValue(new VoteCommandError('No permission', 'cast-vote', 'rejected', 401, { code: '42501' }));
    const confirmed = vi.fn();
    const result = await withVoteAcknowledgement(() => game.persistSyncedAnswerVote(answer, 'valid', 'valid'), confirmed);
    expect(result).toMatchObject({ accepted: false, error: { status: 401, code: '42501' } });
    expect(confirmed).not.toHaveBeenCalled(); render();
    expect(game.roomError).toContain('HTTP 401, 42501');
  });
  it('keeps an accepted dispute vote accepted if refresh fails, without resubmitting', async () => {
    vi.mocked(online.persistOnlineDisputeVote).mockResolvedValue({ accepted: true, resolved: true, finalVerdict: 'variant' });
    vi.mocked(online.getOnlineRevealSnapshot).mockRejectedValue(new Error('Refresh unavailable'));
    const result = await game.persistSyncedDisputeVote('own-answer-dispute', 'variant'); render();
    expect(result).toMatchObject({ accepted: true, resolved: true, refreshWarning: { stage: 'refresh', message: 'Refresh unavailable' } });
    expect(game.roomError).toContain('Vote accepted.');
    expect(await game.persistSyncedDisputeVote('own-answer-dispute', 'variant')).toEqual(result);
    expect(online.persistOnlineDisputeVote).toHaveBeenCalledOnce();
    expect(online.persistOnlineDisputeVote).toHaveBeenCalledWith(expect.objectContaining({ voterPlayerId: 'human', disputeId: 'own-answer-dispute' }));
  });
  it('preserves both resolution and refresh failures separately after acceptance', async () => {
    vi.mocked(online.persistOnlineDisputeVote).mockResolvedValue({ accepted: true,
      warning: new VoteCommandError('Resolve denied', 'resolve-dispute', 'rejected', 403, { code: '42501' }) });
    vi.mocked(online.getOnlineRevealSnapshot).mockRejectedValue(new Error('Refresh unavailable'));
    expect(await game.persistSyncedDisputeVote('dispute', 'valid')).toMatchObject({
      accepted: true, warning: { stage: 'resolve-dispute', status: 403, code: '42501' }, refreshWarning: { stage: 'refresh' },
    });
  });
  it('does not report a stale dispute-opening error after room replacement', async () => {
    let rejectOpening!: (reason: unknown) => void;
    vi.mocked(online.openOnlineAnswerDispute).mockReturnValue(new Promise((_, reject) => { rejectOpening = reject; }));

    const opening = game.openSyncedAnswerDispute(answer);
    await nextTick();

    vi.mocked(online.createOnlineRoom).mockResolvedValue({
      id: 'room-b', code: 'ROOMB', playerId: 'human-b', playerName: 'Human', playerNames: ['Human'],
      hostName: 'Human', isHost: true, playerCount: 1, spectatorCount: 0, expiresAt: '',
      settings: game.room!.settings, setupLocked: false, status: 'lobby', visibility: 'public',
    });
    await game.resetMatch(); render();

    rejectOpening(new Error('old room dispute failed'));
    await opening;
    render();

    expect(game.room).toMatchObject({ id: 'room-b', code: 'ROOMB' });
    expect(game.roomError).toBe('');
  });
  it('does not report a stale dispute-vote error after the round changes', async () => {
    let rejectVote!: (reason: unknown) => void;
    vi.mocked(online.persistOnlineDisputeVote).mockReturnValue(new Promise((_, reject) => { rejectVote = reject; }));

    const voting = game.persistSyncedDisputeVote('dispute', 'invalid');
    await nextTick();

    vi.mocked(online.startOnlineRound).mockResolvedValue({ id: 'round-2', letter: 'B', roundNumber: 2 });
    await game.startRound();
    render();

    rejectVote(new Error('old round dispute failed'));
    const result = await voting;
    render();

    expect(result).toMatchObject({ accepted: false });
    expect(game.currentRound).toMatchObject({ id: 'round-2' });
    expect(game.roomError).toBe('');
  });
  it('coalesces through the refresh step and rejects conflicting clicks', async () => {
    vi.mocked(online.persistOnlineDisputeVote).mockResolvedValue({ accepted: true, resolved: false });
    let resolve!: (value: online.OnlineRevealSnapshot) => void;
    const snapshot = await online.getOnlineRevealSnapshot('room', 'round');
    vi.mocked(online.getOnlineRevealSnapshot).mockReturnValue(new Promise((done) => { resolve = done; }));
    const first = game.persistSyncedDisputeVote('dispute', 'valid');
    const second = game.persistSyncedDisputeVote('dispute', 'valid');
    expect(await game.persistSyncedDisputeVote('dispute', 'invalid')).toMatchObject({ accepted: false });
    resolve(snapshot); expect(await first).toEqual(await second);
    expect(online.persistOnlineDisputeVote).toHaveBeenCalledOnce();
  });
  it('does not let an older reveal poll overwrite the post-resolution snapshot', async () => {
    game.setScreen('reveal'); render();

    const staleAnswer = { ...answer, points: 10, verdict: 'valid' as const };
    const resolvedAnswer = { ...answer, points: 0, verdict: 'invalid' as const };
    const makeSnapshot = (nextAnswer: online.OnlineRevealAnswer): online.OnlineRevealSnapshot => ({
      activePlayerCount: 2,
      submittedPlayerCount: 1,
      answers: [nextAnswer],
      scores: [],
      expectedVoteCount: 1,
      voteCount: 0,
      openDisputeCount: 0,
      isRoundReady: false,
      pendingDisputeVoterNames: [],
      pendingSubmitterNames: ['Other'],
      pendingVoterNames: [],
    });

    let markStaleStarted!: () => void;
    let resolveStale!: (snapshot: online.OnlineRevealSnapshot) => void;
    const staleStarted = new Promise<void>((resolve) => { markStaleStarted = resolve; });
    let markFreshStarted!: () => void;
    let resolveFresh!: (snapshot: online.OnlineRevealSnapshot) => void;
    const freshStarted = new Promise<void>((resolve) => { markFreshStarted = resolve; });
    vi.mocked(online.getOnlineRevealSnapshot)
      .mockImplementationOnce(() => {
        markStaleStarted();
        return new Promise((resolve) => { resolveStale = resolve; });
      })
      .mockImplementationOnce(() => {
        markFreshStarted();
        return new Promise((resolve) => { resolveFresh = resolve; });
      });

    const revealEffect = hooks.effects
      .filter(({ deps }) => deps?.length === 4
        && deps[0] === game.currentRound?.id
        && deps[1] === 'room'
        && deps[2] === true
        && deps[3] === 'reveal')
      .at(-1);
    expect(revealEffect).toBeDefined();
    const cleanup = revealEffect!.run();
    await staleStarted;

    vi.mocked(online.persistOnlineDisputeVote).mockResolvedValue({
      accepted: true, resolved: true, finalVerdict: 'invalid',
    });
    const vote = game.persistSyncedDisputeVote('dispute', 'invalid');
    await freshStarted;
    resolveFresh(makeSnapshot(resolvedAnswer));
    await vote;
    render();

    expect(game.onlineRevealAnswers).toEqual([resolvedAnswer]);

    resolveStale(makeSnapshot(staleAnswer));
    await new Promise<void>((resolve) => setImmediate(resolve));
    render();
    cleanup?.();

    expect(game.onlineRevealAnswers).toEqual([resolvedAnswer]);
  });
  it('blocks a poll that resolves after mutation acknowledgement but before refresh starts', async () => {
    game.setScreen('reveal'); render();
    const poll = deferred<online.OnlineRevealSnapshot>();
    const refresh = deferred<online.OnlineRevealSnapshot>();
    const acknowledgement = deferred<VoteReceipt>();
    let markRefreshStarted!: () => void;
    const refreshStarted = new Promise<void>((resolve) => { markRefreshStarted = resolve; });
    vi.mocked(online.getOnlineRevealSnapshot)
      .mockImplementationOnce(() => poll.promise)
      .mockImplementationOnce(() => {
        markRefreshStarted();
        return refresh.promise;
      });
    vi.mocked(online.persistOnlineDisputeVote).mockReturnValue(acknowledgement.promise);

    const cleanup = startRevealPoll();
    const vote = game.persistSyncedDisputeVote('dispute', 'invalid');
    acknowledgement.resolve({ accepted: true, resolved: true, finalVerdict: 'invalid' });
    poll.resolve(makeRevealSnapshot({ ...answer, verdict: 'valid', points: 10 }));
    await refreshStarted;
    render();
    expect(game.onlineRevealAnswers).toEqual([]);

    refresh.resolve(makeRevealSnapshot({ ...answer, verdict: 'invalid', points: 0 }));
    await vote;
    render();
    cleanup?.();
    expect(game.onlineRevealAnswers[0]).toMatchObject({ verdict: 'invalid', points: 0 });
  });
  it('keeps a later poll from superseding an in-flight authoritative refresh with older data', async () => {
    game.setScreen('reveal'); render();
    const authoritative = deferred<online.OnlineRevealSnapshot>();
    let markAuthoritativeStarted!: () => void;
    const authoritativeStarted = new Promise<void>((resolve) => { markAuthoritativeStarted = resolve; });
    vi.mocked(online.getOnlineRevealSnapshot).mockResolvedValueOnce(makeRevealSnapshot());
    const firstCleanup = startRevealPoll();
    await nextTick();

    vi.mocked(online.getOnlineRevealSnapshot).mockImplementationOnce(() => {
      markAuthoritativeStarted();
      return authoritative.promise;
    });
    vi.mocked(online.persistOnlineDisputeVote).mockResolvedValue({ accepted: true, resolved: true, finalVerdict: 'invalid' });
    const vote = game.persistSyncedDisputeVote('dispute', 'invalid');
    await authoritativeStarted;

    const olderPoll = makeRevealSnapshot({ ...answer, verdict: 'valid', points: 10 });
    vi.mocked(online.getOnlineRevealSnapshot).mockResolvedValueOnce(olderPoll);
    const laterCleanup = startRevealPoll();
    await nextTick();
    render();
    expect(game.onlineRevealAnswers[0]?.verdict).not.toBe('valid');

    authoritative.resolve(makeRevealSnapshot({ ...answer, verdict: 'invalid', points: 0 }));
    await vote;
    render();
    firstCleanup?.(); laterCleanup?.();
    expect(game.onlineRevealAnswers[0]).toMatchObject({ verdict: 'invalid', points: 0 });
  });
  it('commits no stale reveal or CPU state while bot and match data are loading', async () => {
    game.setScreen('reveal'); render();
    const bot = deferred<online.OnlineBotRoundSnapshot>();
    const standings = deferred<online.OnlineMatchStanding[]>();
    const history = deferred<online.OnlinePlayerRoundSummary[]>();
    const authoritative = deferred<online.OnlineRevealSnapshot>();
    let markBotStarted!: () => void;
    const botStarted = new Promise<void>((resolve) => { markBotStarted = resolve; });
    let markMatchStarted!: () => void;
    const matchStarted = new Promise<void>((resolve) => { markMatchStarted = resolve; });
    let markAuthoritativeStarted!: () => void;
    const authoritativeStarted = new Promise<void>((resolve) => { markAuthoritativeStarted = resolve; });
    vi.mocked(online.getOnlineRevealSnapshot).mockImplementationOnce(() => Promise.resolve(makeRevealSnapshot(answer, {
      submittedPlayerCount: 2,
      isRoundReady: true,
    }))).mockImplementationOnce(() => {
      markAuthoritativeStarted();
      return authoritative.promise;
    });
    vi.mocked(online.getOnlineBotRoundSnapshot).mockImplementationOnce(() => {
      markBotStarted();
      return bot.promise;
    });
    vi.mocked(online.getOnlineMatchStandings)
      .mockImplementationOnce(() => { markMatchStarted(); return standings.promise; })
      .mockResolvedValue([]);
    vi.mocked(online.getOnlinePlayerRoundHistory)
      .mockImplementationOnce(() => history.promise)
      .mockResolvedValue([]);

    const cleanup = startRevealPoll();
    await botStarted;
    bot.resolve({ roomId: 'room', roundId: 'round', bots: [{
      playerId: 'bot-1', playerName: 'CPU', personality: 'Careful', score: 10, totalScore: 10,
      answeredCount: 1,
      answers: [{ category: 'Name', answer: 'Alice', points: 10, verdict: 'valid' }],
    }] });
    await matchStarted;

    vi.mocked(online.persistOnlineDisputeVote).mockResolvedValue({ accepted: true, resolved: true, finalVerdict: 'invalid' });
    const vote = game.persistSyncedDisputeVote('dispute', 'invalid');
    await authoritativeStarted;
    standings.resolve([]); history.resolve([]);
    await nextTick();
    render();
    expect(game.onlineRevealAnswers).toEqual([]);
    expect(game.botRoundAnswers).toEqual([]);

    authoritative.resolve(makeRevealSnapshot({ ...answer, verdict: 'invalid', points: 0 }));
    await vote;
    render();
    cleanup?.();
    expect(game.onlineRevealAnswers[0]).toMatchObject({ verdict: 'invalid', points: 0 });
    expect(game.botRoundAnswers).toEqual([]);
  });
  it('rejects a response that resolves immediately after leaving the room', async () => {
    game.setScreen('reveal'); render();
    const poll = deferred<online.OnlineRevealSnapshot>();
    vi.mocked(online.getOnlineRevealSnapshot).mockImplementationOnce(() => poll.promise);
    const cleanup = startRevealPoll();
    const leaving = game.leaveRoom();
    poll.resolve(makeRevealSnapshot({ ...answer, verdict: 'valid', points: 10 }));
    await leaving;
    await nextTick();
    render();
    cleanup?.();
    expect(game.screen).toBe('home');
    expect(game.onlineRevealAnswers).toEqual([]);
  });
  it('rejects a response that resolves immediately after match reset', async () => {
    game.setScreen('reveal'); render();
    const poll = deferred<online.OnlineRevealSnapshot>();
    vi.mocked(online.getOnlineRevealSnapshot).mockImplementationOnce(() => poll.promise);
    const cleanup = startRevealPoll();
    const resetting = game.resetMatch();
    poll.resolve(makeRevealSnapshot({ ...answer, verdict: 'valid', points: 10 }));
    await resetting;
    await nextTick();
    render();
    cleanup?.();
    expect(game.screen).toBe('lobby');
    expect(game.currentRound).toBeNull();
    expect(game.onlineRevealAnswers).toEqual([]);
  });
});
