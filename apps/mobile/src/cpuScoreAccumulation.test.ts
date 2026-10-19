import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnlineBotRoundSnapshot, OnlineRoomSettings } from './onlineRooms';
import { countAnsweredBotAnswers } from './statisticsPresentation';

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
  createOnlineRoom: vi.fn(), startOnlineRound: vi.fn(), completeOnlineRound: vi.fn(),
  getOnlineBotRoundSnapshot: vi.fn(), getOnlineMatchStandings: vi.fn(),
  getOnlinePlayerRoundHistory: vi.fn(), getOnlineRoomSnapshot: vi.fn(), getOnlineRevealSnapshot: vi.fn(),
}));
vi.mock('./devDiagnostics', () => ({ debugGameEvent: vi.fn(), debugGameError: vi.fn() }));
vi.mock('./qaTelemetry', () => ({ emitQaTelemetry: vi.fn() }));
import * as online from './onlineRooms';
import { useLocalGame } from './useLocalGame';

let game: ReturnType<typeof useLocalGame>;
const settings: OnlineRoomSettings = {
  activeModeLabel: 'Live Brawl', activeModeRules: '', botCount: 1, botDifficulty: 'Normal',
  categories: ['Name', 'Place', 'Animal'], roundSeconds: 60, scoringOwner: 'Opponents',
  scoringStyle: 'Classic', targetRounds: 3,
};
function render() {
  hooks.cursor = 0; hooks.effects = [];
  game = useLocalGame();
}
// Same wire shape and accumulation contract as get_online_bot_round_snapshot:
// score is the stored round answer sum; totalScore sums all rounds through N.
function snapshot(roundScores: number[]): OnlineBotRoundSnapshot {
  const score = roundScores.at(-1)!;
  const points = [0, 1, 2].map((index) => Math.max(0, Math.min(10, score - index * 10)));
  return { roomId: 'room', roundId: `round-${roundScores.length}`, bots: [{
    playerId: 'bot-1', playerName: 'Nova', personality: 'Careful',
    answers: settings.categories.map((category, i) => ({
      category, answer: ['Alice', 'Accra', 'Ant'][i], points: points[i],
      verdict: points[i] === 10 ? 'valid' : points[i] === 5 ? 'duplicate' : 'invalid',
    })),
    answeredCount: 3, score, totalScore: roundScores.reduce((sum, value) => sum + value, 0),
  }] };
}
async function beginRound(roundScores: number[]) {
  const roundNumber = roundScores.length;
  vi.mocked(online.startOnlineRound).mockResolvedValue({ id: `round-${roundNumber}`, letter: 'A', roundNumber });
  vi.mocked(online.getOnlineBotRoundSnapshot).mockResolvedValue(snapshot(roundScores));
  vi.mocked(online.getOnlineMatchStandings).mockResolvedValue([
    { playerId: 'human', playerName: 'Human', totalScore: 40 * roundNumber, lastRoundScore: 40, roundsPlayed: roundNumber },
    { playerId: 'other-human', playerName: 'Other', totalScore: 5 * roundNumber, lastRoundScore: 5, roundsPlayed: roundNumber },
  ]);
  vi.mocked(online.getOnlinePlayerRoundHistory).mockResolvedValue(roundScores.map((_, i) => ({
    roundId: `round-${i + 1}`, roundNumber: i + 1, letter: 'A', answeredCount: 3, score: 40,
  })));
  await game.startRound(); render();
  expect(game.currentRound?.id).toBe(`round-${roundNumber}`);
}
async function poll(value: OnlineBotRoundSnapshot) {
  game.setScreen('scoring'); render();
  vi.mocked(online.getOnlineBotRoundSnapshot).mockResolvedValueOnce(value);
  vi.mocked(online.getOnlineRoomSnapshot).mockResolvedValue({
    activeRound: { ...game.currentRound!, status: 'revealing' }, settings,
    playerCount: 2, playerNames: ['Human', 'Other'], hostName: 'Human', hostPlayerId: 'human',
    setupLocked: true, status: 'revealing', spectatorCount: 0, isExpired: false,
    expiresAt: '', visibility: 'public',
  });
  vi.mocked(online.getOnlineRevealSnapshot).mockResolvedValue({
    activePlayerCount: 2, submittedPlayerCount: 2, answers: [], scores: [],
    expectedVoteCount: 0, voteCount: 0, openDisputeCount: 0, isRoundReady: true,
    pendingDisputeVoterNames: [], pendingSubmitterNames: [], pendingVoterNames: [],
  });
  const cleanup = hooks.effects.filter(({ deps }) => deps?.length === 4
    && deps[0] === game.currentRound?.id && deps[1] === 'room' && deps[2] === true && deps[3] === 'scoring')
    .map(({ run }) => run());
  try {
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    cleanup.forEach((stop) => stop?.());
  }
  render();
  expect(game.roomError).toBe('');
}
async function finish() {
  await game.finishRound(); render();
  expect(game.roomError).toBe('');
}
function cpuTotal() { return game.localMatchStandings.find((entry) => entry.id === 'bot-1')?.score; }

beforeEach(async () => {
  vi.clearAllMocks(); hooks.slots = [];
  render(); game.setBotCount(1); render();
  vi.mocked(online.createOnlineRoom).mockResolvedValue({
    id: 'room', code: 'ABC123', playerId: 'human', playerName: 'Human', playerNames: ['Human', 'Other'],
    hostName: 'Human', isHost: true, playerCount: 2, spectatorCount: 0,
    expiresAt: '', settings, setupLocked: true, status: 'lobby', visibility: 'public',
  });
});
async function join() { await game.createRoom(); render(); }

describe('real finishRound CPU accumulation', () => {
  it('starts Practice locally without creating an online room', () => {
    const practiceSettings = {
      botCount: 2,
      botDifficulty: 'Hard' as const,
      categories: ['Name', 'Place', 'Animal', 'Food', 'Object'] as const,
      label: 'Practice',
      matchDurationSeconds: null,
      roundSeconds: 60,
      rounds: 5,
      rulesSummary: 'Five rounds, five categories, two hard CPUs.',
      scoringOwner: 'Opponents' as const,
      scoringStyle: 'Strict' as const,
    };

    game.startPractice(practiceSettings);
    render();

    expect(online.createOnlineRoom).not.toHaveBeenCalled();
    expect(game.room).toMatchObject({ isOnline: false, code: '', playerCount: 1, status: 'in_round' });
    expect(game.currentRound).toMatchObject({ id: expect.stringMatching(/^local-practice-/), roundNumber: 1 });
    expect(game.roundLetter).toMatch(/^[A-Z]$/);
    expect(game.selectedCategories).toEqual(practiceSettings.categories);
    expect(game.botPlayers).toHaveLength(2);
    expect(game.targetRounds).toBe(5);
    expect(game.roundSeconds).toBe(60);
    expect(game.scoringStyle).toBe('Strict');
    expect(game.screen).toBe('round');
  });

  it('keeps an already-applied 30-point snapshot at 30, not 60', async () => {
    await join(); await beginRound([30]); await poll(snapshot([30]));
    expect(game.botPlayers[0].totalScore).toBe(30);
    expect(game.botRoundAnswers).toHaveLength(3);
    await finish(); expect(cpuTotal()).toBe(30);
    expect(game.botPlayers[0].lastScore).toBe(30);
  });
  it('accumulates multiple recorded rounds exactly once and preserves human scores/rank', async () => {
    await join();
    for (const scores of [[30], [30, 25], [30, 25, 20]]) {
      await beginRound(scores); await poll(snapshot(scores)); await finish();
      expect(cpuTotal()).toBe(scores.reduce((sum, value) => sum + value, 0));
    }
    expect(game.localMatchStandings).toEqual([
      { id: 'human', score: 120 }, { id: 'bot-1', score: 75 }, { id: 'other-human', score: 15 },
    ]);
    expect(game.lastMatchResult).toMatchObject({ playerRank: 1, playerScore: 120, pointsEarned: 40, totalPlayers: 3 });
    expect(game.onlineMatchStandings.map((entry) => entry.totalScore)).toEqual([120, 15]);
  });
  it('repeated snapshots and repeated completion never add the round again', async () => {
    await join(); await beginRound([30]);
    await poll(snapshot([30])); await poll(snapshot([30]));
    await finish(); await finish();
    expect(cpuTotal()).toBe(30);
  });
  it('counts one completed match, not each round or repeated final completion', async () => {
    settings.targetRounds = 1;
    try {
      await join();
      await beginRound([30]); await poll(snapshot([30]));
      await finish();
      const firstProfile = {
        allTimePoints: game.playerProfile.allTimePoints,
        recentMatches: [...game.playerProfile.recentMatches],
      };
      const firstResult = game.lastMatchResult;
      expect(game.playerProfile.gamesPlayed).toBe(1);
      expect(firstProfile.allTimePoints).toBeGreaterThan(0);
      expect(firstProfile.recentMatches).toHaveLength(1);
      expect(firstResult).not.toBeNull();

      await finish();
      expect(game.playerProfile.gamesPlayed).toBe(1);
      expect(game.playerProfile.allTimePoints).toBe(firstProfile.allTimePoints);
      expect(game.playerProfile.recentMatches).toEqual(firstProfile.recentMatches);
      expect(game.lastMatchResult).toEqual(firstResult);

      await game.resetMatch(); render();
      await beginRound([30]); await poll(snapshot([30])); await finish();
      expect(game.playerProfile.gamesPlayed).toBe(2);
      expect(game.playerProfile.allTimePoints).toBe(firstProfile.allTimePoints * 2);
      expect(game.playerProfile.recentMatches).toHaveLength(2);
      expect(game.lastMatchResult).not.toEqual(firstResult);
    } finally {
      settings.targetRounds = 3;
    }
  });
  it('finishes from the current server snapshot after older cached snapshots arrive out of order', async () => {
    await join(); await beginRound([30]); await finish();
    await beginRound([30, 25]);
    await poll(snapshot([30, 25])); await poll(snapshot([30]));
    // Poll ordering itself is outside this batch; completion must not add to
    // either stale (30) or current (55) cached cumulative state.
    vi.mocked(online.getOnlineBotRoundSnapshot).mockResolvedValue(snapshot([30, 25]));
    await finish(); expect(cpuTotal()).toBe(55);
  });
  it('handles a fresh CPU without a cached score or answers', async () => {
    await join(); await beginRound([30]);
    expect(game.botRoundAnswers).toEqual([]);
    await finish(); expect(cpuTotal()).toBe(30);
  });
  it('preserves a fresh CPU authoritative zero score', async () => {
    await join(); await beginRound([0]); await poll(snapshot([0]));
    await finish(); expect(cpuTotal()).toBe(0);
    expect(game.botPlayers[0].lastScore).toBe(0);
  });
  it('does not fall back to local addition if the authoritative fetch fails', async () => {
    await join(); await beginRound([30]); await poll(snapshot([30]));
    vi.mocked(online.getOnlineBotRoundSnapshot).mockRejectedValueOnce(new Error('snapshot unavailable'));
    await game.finishRound(); render();
    expect(game.roomError).toBe('snapshot unavailable');
    expect(online.completeOnlineRound).not.toHaveBeenCalled();
    expect(game.botPlayers[0].totalScore).toBe(30);
  });
  it('retains local/practice accumulation without server snapshots', async () => {
    // No online room: real local answer generation, scoring, and completion.
    await game.submitAnswers(); render();
    for (const answer of game.botRoundAnswers) game.updateBotAnswerVerdict(answer.botId, answer.category, 'valid');
    render();
    const roundScore = game.botRoundAnswers.length * 10;
    expect(roundScore).toBeGreaterThan(0);
    await finish(); expect(cpuTotal()).toBe(roundScore);
    await finish(); expect(cpuTotal()).toBe(roundScore * 2);
    expect(online.getOnlineBotRoundSnapshot).not.toHaveBeenCalled();
    expect(online.completeOnlineRound).not.toHaveBeenCalled();
  });
  it('excludes a blank CPU row from answered count without changing score', () => {
    const answers = [
      { botId: 'bot-1', category: 'Name', answer: 'Alice', points: 10, verdict: 'valid' as const },
      { botId: 'bot-1', category: 'Place', answer: '', points: 0, verdict: 'blank' as const },
      { botId: 'bot-1', category: 'Animal', answer: 'Ant', points: 5, verdict: 'duplicate' as const },
    ];
    expect(countAnsweredBotAnswers(answers, 'bot-1')).toBe(2);
    expect(answers.filter((answer) => answer.answer.trim()).reduce((sum, answer) => sum + answer.points, 0)).toBe(15);
  });
});
