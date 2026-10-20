import { createVoteFlights, describeVoteFailure, voteFailure, VoteCommandError, type VoteOutcome } from './voteCommands';
import { REAL_PLAYER_WAIT_MS, remainingSearchMs, createSingleFlight } from './liveMatchmaking';
import { judgeAnswerFromEvidence } from './botStrategy';
import { pickRoundLetter, scoreAnswer, type AnswerVerdict } from '@animal-name-place/game-core';
import {
  createBotRoundAnswers,
  getKnownCategoriesForAnswer,
  markDuplicateBotAnswers,
  scoreBotOwnAnswers,
  scoreBotRoundAnswers,
  type AnswersByCategory,
  type BotDifficulty,
  type BotPersonality,
  type BotRoundAnswer,
} from './localBotRound';
export { getKnownCategoriesForAnswer } from './localBotRound';
export type { BotDifficulty, BotPersonality, BotRoundAnswer } from './localBotRound';
import {
  DEFAULT_ROUND_SECONDS,
  STARTER_CATEGORIES,
  type StarterCategory,
} from '@animal-name-place/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  advanceLiveBrawlSession,
  createOnlineRoom,
  completeOnlineRound,
  finalizeOnlineRoundTimeout,
  findOrCreatePublicRoom,
  getOnlineMatchStandings,
  getOnlineBotRoundSnapshot,
  getOnlineBotRoster,
  type OnlineBotRoundSnapshot,
  getOnlinePlayerAnswers,
  getOnlinePlayerRoundHistory,
  getOnlineRevealSnapshot,
  getOnlineRoomSnapshot,
  joinOnlineRoom,
  leaveOnlineRoom,
  openOnlineAnswerDispute,
  persistOnlineDisputeVote,
  persistOnlineAnswerVoteById,
  resumeOnlineRoom,
  saveOnlineDraftAnswer,
  startOnlineRound,
  submitOnlineReport,
  submitOnlineAnswers,
  updateOnlineRoomSettings,
  type OnlineRoomSettings,
  type OnlineResumeResult,
  type OnlineMatchStanding,
  type OnlineReportInput,
  type OnlinePlayerRoundSummary,
  type OnlineVoteVerdict,
  type OnlineRevealAnswer,
  type OnlineRevealSnapshot,
  type OnlineRoundScore,
  type OnlineRoundResult,
  type RoomStatus,
  type RoomVisibility,
} from './onlineRooms';
import { debugGameError, debugGameEvent } from './devDiagnostics';
import { getDeadlineRemainingSeconds, getPhaseDeadline, getTimeoutPhase } from './timeoutRules';
import { emitQaTelemetry } from './qaTelemetry';
import {
  createOnlineRevealSnapshotCoordinator,
  type OnlineRevealSnapshotRequest,
  type OnlineRevealSnapshotRequestKind,
} from './onlineRevealSnapshotCoordinator';

export type Screen = 'boot' | 'rules' | 'nameSetup' | 'home' | 'modeDetail' | 'join' | 'lobby' | 'round' | 'reveal' | 'scoring' | 'leaderboard' | 'globalLeaderboard' | 'settings' | 'themes' | 'about';
export type PlayerProfile = {
  allTimePoints: number;
  avatarKey: string;
  bestStreak: number;
  currentStreak: number;
  gamesPlayed: number;
  recentMatches: MatchRecord[];
};

export type MatchResult = {
  achievementUnlockedLabels: string[];
  isWinner: boolean;
  playerRank: number;
  playerScore: number;
  pointsEarned: number;
  totalPlayers: number;
};
export type MatchRecord = {
  id: string;
  modeLabel: string;
  playedAt: string;
  playerRank: number;
  playerScore: number;
  pointsEarned: number;
  roundsPlayed: number;
  totalPlayers: number;
  outcome: 'win' | 'loss';
};
export type MatchStandingEntry = {
  id: string;
  score: number;
};

export type LocalRoom = {
  code: string;
  expiresAt?: string;
  hostName: string;
  id?: string;
  isOnline: boolean;
  isHost: boolean;
  letterPickerName?: string;
  letterPickerPlayerId?: string;
  playerCount: number;
  playerId?: string;
  playerNames: string[];
  playerName: string;
  settings: OnlineRoomSettings;
  setupLocked: boolean;
  status: RoomStatus;
  spectatorCount: number;
  visibility: RoomVisibility;
};

export type RoundSummary = {
  id: string;
  roundNumber: number;
  letter: string;
  answeredCount: number;
  categoryCount: number;
  score: number;
};

export type CurrentRound = OnlineRoundResult | null;
type OnlineMatchContext = {
  generation: number;
  roomId: string;
  roundId: string | null;
};
type OnlineRoundAgreement = Pick<
  OnlineRevealSnapshot,
  | 'activePlayerCount'
  | 'disputeEndsAt'
  | 'expectedVoteCount'
  | 'isRoundReady'
  | 'openDisputeCount'
  | 'pendingDisputeVoterNames'
  | 'pendingSubmitterNames'
  | 'pendingVoterNames'
  | 'scoringEndsAt'
  | 'submittedPlayerCount'
  | 'voteCount'
>;

const EMPTY_ONLINE_ROUND_AGREEMENT: OnlineRoundAgreement = {
  activePlayerCount: 0,
  disputeEndsAt: null,
  expectedVoteCount: 0,
  isRoundReady: false,
  openDisputeCount: 0,
  pendingDisputeVoterNames: [],
  pendingSubmitterNames: [],
  pendingVoterNames: [],
  scoringEndsAt: null,
  submittedPlayerCount: 0,
  voteCount: 0,
};

function getOnlineRoundAgreement(snapshot: OnlineRevealSnapshot): OnlineRoundAgreement {
  return {
    activePlayerCount: snapshot.activePlayerCount,
    disputeEndsAt: snapshot.disputeEndsAt ?? null,
    expectedVoteCount: snapshot.expectedVoteCount,
    isRoundReady: snapshot.isRoundReady,
    openDisputeCount: snapshot.openDisputeCount,
    pendingDisputeVoterNames: snapshot.pendingDisputeVoterNames,
    pendingSubmitterNames: snapshot.pendingSubmitterNames,
    pendingVoterNames: snapshot.pendingVoterNames,
    scoringEndsAt: snapshot.scoringEndsAt ?? null,
    submittedPlayerCount: snapshot.submittedPlayerCount,
    voteCount: snapshot.voteCount,
  };
}
export type BotPlayer = {
  id: string;
  name: string;
  lastScore: number;
  personality: BotPersonality;
  totalScore: number;
};
export type ScoringStyle = 'Classic' | 'Strict';
export type ScoringOwner = 'Self' | 'Opponents';
export type GameModeSetup = {
  botCount: number;
  botDifficulty: BotDifficulty;
  categories: readonly StarterCategory[];
  label: string;
  matchDurationSeconds?: number | null;
  roundSeconds: number;
  rounds: number;
  rulesSummary: string;
  scoringOwner?: ScoringOwner;
  scoringStyle: ScoringStyle;
};

const DEFAULT_NAME = '';
const BOT_LIMIT = 7;
const ROUND_LIMIT = { max: 10, min: 1 };
const TIMER_LIMIT = { max: 120, min: 30, step: 15 };
const LETTER_POOL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const LETTER_BAG_STORAGE_KEY = 'animal-name-place/letter-bag/v1';
const PLAYER_NAME_STORAGE_KEY = 'animal-name-place/player-name/v1';
const PROFILE_STORAGE_KEY = 'animal-name-place/player-profile/v1';
const RULES_SEEN_STORAGE_KEY = 'animal-name-place/rules-seen/v1';
const ROOM_SYNC_INTERVAL_MS = 3000;
const REVEAL_SYNC_INTERVAL_MS = 1000;
const DRAFT_SAVE_DEBOUNCE_MS = 350;
const MATCH_STATE_SYNC_INTERVAL_MS = 5000;
const LIVE_TABLE_BOT_FILL_INTERVAL_SECONDS = REAL_PLAYER_WAIT_MS / 1000;
const LIVE_BRAWL_CLIENT_VERSION = '1.1.0';
const LIVE_TABLE_EXPIRES_IN_MINUTES = 10;
const LIVE_BRAWL_RULESET_VERSION = 1;
const LIVE_TABLE_TARGET_PLAYERS = 5;
const DEFAULT_PROFILE: PlayerProfile = {
  allTimePoints: 0,
  avatarKey: 'spark',
  bestStreak: 0,
  currentStreak: 0,
  gamesPlayed: 0,
  recentMatches: [],
};
const LIVE_TABLE_SETUP: GameModeSetup = {
  botCount: 0,
  botDifficulty: 'Normal',
  categories: ['Name', 'Place', 'Animal', 'Object'],
  label: 'Live Brawl',
  matchDurationSeconds: null,
  roundSeconds: 60,
  rounds: 3,
  rulesSummary: 'Public quick match: same letter, classic categories, brawl scoring.',
  scoringOwner: 'Opponents',
  scoringStyle: 'Classic',
};
const BOT_NAMES = [
  'Byte', 'Nova', 'Cipher', 'Orbit', 'Vector', 'Echo', 'Pixel', 'Fuse',
  'Quanta', 'Nexus', 'Sable', 'Juno', 'Vanta', 'Kairo', 'Zeno', 'Halo',
];
const BOT_PERSONALITIES: BotPersonality[] = [
  'Aggressive',
  'Agreeable',
  'Sloppy',
  'Perfect',
  'Skeptical',
  'Generous',
  'Chaotic',
  'Scholar',
  'Speedy',
  'Careful',
];
function getUnlockedAchievementLabels(profile: PlayerProfile) {
  const unlockedLabels: string[] = [];

  if (profile.gamesPlayed >= 1) {
    unlockedLabels.push('First Game');
  }

  if (profile.currentStreak >= 3) {
    unlockedLabels.push('Streak 3');
  }

  if (profile.currentStreak >= 5) {
    unlockedLabels.push('Hot Streak');
  }

  if (profile.allTimePoints >= 100) {
    unlockedLabels.push('100 Points');
  }

  if (profile.allTimePoints >= 500) {
    unlockedLabels.push('500 Points');
  }

  if (profile.allTimePoints >= 1000) {
    unlockedLabels.push('1K Points');
  }

  if (profile.gamesPlayed >= 5) {
    unlockedLabels.push('5 Games');
  }

  if (profile.gamesPlayed >= 10) {
    unlockedLabels.push('10 Games');
  }

  return unlockedLabels;
}

function getLiveBrawlLeagueBucket(score: number) {
  if (score >= 4000) {
    return 'legend';
  }

  if (score >= 2600) {
    return 'master';
  }

  if (score >= 1800) {
    return 'diamond';
  }

  if (score >= 1100) {
    return 'platinum';
  }

  if (score >= 700) {
    return 'gold';
  }

  if (score >= 300) {
    return 'silver';
  }

  if (score >= 100) {
    return 'bronze';
  }

  return 'rookie';
}

function getLiveBrawlLevelBand(gamesPlayed: number) {
  const level = Math.max(1, Math.floor(gamesPlayed / 3) + 1);
  const bandStart = Math.floor((level - 1) / 5) * 5 + 1;
  const bandEnd = bandStart + 4;

  return `level-${bandStart}-${bandEnd}`;
}

function getLiveBrawlMatchmakingBucket(profile: PlayerProfile) {
  const leagueBucket = getLiveBrawlLeagueBucket(profile.allTimePoints);
  const levelBand = getLiveBrawlLevelBand(profile.gamesPlayed);

  return `${leagueBucket}:${levelBand}:global:ruleset-${LIVE_BRAWL_RULESET_VERSION}`;
}

function getNewAchievementLabels(previousProfile: PlayerProfile, nextProfile: PlayerProfile) {
  const previousLabels = getUnlockedAchievementLabels(previousProfile);

  return getUnlockedAchievementLabels(nextProfile).filter((label) => !previousLabels.includes(label));
}

type VerdictsByCategory = Record<StarterCategory, AnswerVerdict>;

function createEmptyAnswers(): AnswersByCategory {
  return Object.fromEntries(STARTER_CATEGORIES.map((category) => [category, ''])) as AnswersByCategory;
}

function createVerdictsFromAnswers(
  answersByCategory: AnswersByCategory,
  _letter = '',
  _scoringStyle: ScoringStyle = 'Classic',
): VerdictsByCategory {
  return Object.fromEntries(
    STARTER_CATEGORIES.map((category) => {
      const answer = answersByCategory[category].trim();

      if (!answer) {
        return [category, 'blank'];
      }

      return [category, 'blank'];
    }),
  ) as VerdictsByCategory;
}

export function createOpponentVerdictsFromAnswers(
  answersByCategory: AnswersByCategory,
  letter = '',
  scoringStyle: ScoringStyle = 'Classic',
  opponentPersonalities: readonly BotPersonality[] = [],
  difficulty: BotDifficulty = 'Normal',
): VerdictsByCategory {
  const hasAggressiveOpponent = opponentPersonalities.includes('Aggressive');
  const hasCarefulOpponent = opponentPersonalities.includes('Careful');
  const hasPerfectOpponent = opponentPersonalities.includes('Perfect');
  const hasScholarOpponent = opponentPersonalities.includes('Scholar');
  const hasSkepticalOpponent = opponentPersonalities.includes('Skeptical');
  const hasStrictOpponent = hasAggressiveOpponent || hasPerfectOpponent || hasScholarOpponent || hasSkepticalOpponent;

  return Object.fromEntries(
    STARTER_CATEGORIES.map((category) => {
      const answer = answersByCategory[category].trim();

      if (!answer) {
        return [category, 'blank'];
      }

      const knownCategories = getKnownCategoriesForAnswer(answer);
      const knownInCurrentCategory = knownCategories.includes(category);
      const knownInOtherCategory = knownCategories.some((knownCategory) => knownCategory !== category);
      const effectiveDifficulty = hasStrictOpponent || hasCarefulOpponent ? 'Hard' : difficulty;

      return [category, judgeAnswerFromEvidence({
        answer,
        difficulty: effectiveDifficulty,
        knownInCurrentCategory,
        knownInOtherCategory,
        letter,
        scoringStyle,
      })];
    }),
  ) as VerdictsByCategory;
}

function getRemainingSeconds(endsAt?: string, fallbackSeconds = DEFAULT_ROUND_SECONDS) {
  if (!endsAt) {
    return fallbackSeconds;
  }

  return Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 1000));
}

function createAnonymousName() {
  return `Anonymous${Math.floor(100 + Math.random() * 900)}`;
}

function pickBotNames(count: number, currentNames: readonly string[] = []) {
  const nextNames = currentNames.slice(0, count);

  while (nextNames.length < count) {
    const availableNames = BOT_NAMES.filter((name) => !nextNames.includes(name));
    const pool = availableNames.length ? availableNames : BOT_NAMES;
    nextNames.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  return nextNames;
}

function pickBotPersonalities(count: number, currentPersonalities: readonly BotPersonality[] = []) {
  const nextPersonalities = currentPersonalities.slice(0, count);

  while (nextPersonalities.length < count) {
    const availablePersonalities = BOT_PERSONALITIES.filter((personality) => !nextPersonalities.includes(personality));
    const pool = availablePersonalities.length ? availablePersonalities : BOT_PERSONALITIES;
    nextPersonalities.push(pool[Math.floor(Math.random() * pool.length)]);
  }

  return nextPersonalities;
}

function normalizeLetterBag(storedLetters: unknown) {
  if (!Array.isArray(storedLetters)) {
    return LETTER_POOL;
  }

  const cleanLetters = storedLetters
    .filter((letter): letter is string => typeof letter === 'string')
    .map((letter) => letter.toUpperCase())
    .filter((letter, index, letters) => LETTER_POOL.includes(letter) && letters.indexOf(letter) === index);

  return cleanLetters.length ? cleanLetters : LETTER_POOL;
}

function pickNextLetterFromBag(availableLetters: readonly string[]) {
  const cleanLetters = availableLetters.length ? availableLetters : LETTER_POOL;

  return pickRoundLetter(cleanLetters.join(''));
}

function removeLetterFromBag(availableLetters: readonly string[], usedLetter: string) {
  const nextLetters = availableLetters.filter((letter) => letter !== usedLetter);

  return nextLetters.length ? nextLetters : LETTER_POOL;
}

export function useLocalGame() {
  const disputeVoteFlight = useRef(createVoteFlights());
  const completedMatchRecordedRef = useRef(false);
  const draftSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const roundSubmissionRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const roundSubmissionOwnerRef = useRef<symbol | null>(null);
  const timeoutFinalizationRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const timeoutFinalizationOwnerRef = useRef<symbol | null>(null);
  const onlineRevealSnapshotCoordinatorRef = useRef(createOnlineRevealSnapshotCoordinator());
  const matchGenerationRef = useRef(0);
  const lastOnlineMatchSyncAtRef = useRef(0);
  const [screen, setScreen] = useState<Screen>('boot');
  const [playerName, setPlayerName] = useState(DEFAULT_NAME);
  const [hasStoredPlayerName, setHasStoredPlayerName] = useState(false);
  const [skipRulesOnLaunch, setSkipRulesOnLaunch] = useState(false);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [room, setRoom] = useState<LocalRoom | null>(null);
  const [roomExpiredNotice, setRoomExpiredNotice] = useState(false);
  const [roomRejoinedNotice, setRoomRejoinedNotice] = useState(false);
  const [roomError, setRoomError] = useState('');
  const [isRoomBusy, setIsRoomBusy] = useState(false);
  const [isRoundBusy, setIsRoundBusy] = useState(false);
  const [liveTableCountdownRemaining, setLiveTableCountdownRemaining] = useState<number | null>(null);
  const [liveTableAutoStartKey, setLiveTableAutoStartKey] = useState('');
  const joinFlight = useRef(createSingleFlight());
  const matchResetInFlightRef = useRef<Promise<void> | null>(null);
  const liveAdvanceInFlight = useRef(false);
  const liveRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveBrawlInFlight = useRef(false);
  const editSnapshotRef = useRef<OnlineRoomSettings | null>(null);
  const [isEditingBrawl, setIsEditingBrawl] = useState(false);
  const [isSavingBrawl, setIsSavingBrawl] = useState(false);
  const [currentRound, setCurrentRoundState] = useState<CurrentRound>(null);
  const [roundLetter, setRoundLetter] = useState('');
  const [manualRoundLetter, setManualRoundLetter] = useState('');
  const [letterBag, setLetterBag] = useState<string[]>(LETTER_POOL);
  const [timeRemaining, setTimeRemaining] = useState(DEFAULT_ROUND_SECONDS);
  const [answers, setAnswers] = useState<AnswersByCategory>(() => createEmptyAnswers());
  const [verdicts, setVerdicts] = useState<VerdictsByCategory>(() => createVerdictsFromAnswers(createEmptyAnswers()));
  const [selectedCategories, setSelectedCategories] = useState<StarterCategory[]>([...STARTER_CATEGORIES]);
  const [roundHistory, setRoundHistory] = useState<RoundSummary[]>([]);
  const [roundSubmitted, setRoundSubmitted] = useState(false);
  const [botCount, setBotCountState] = useState(0);
  const [botDifficulty, setBotDifficultyState] = useState<BotDifficulty>('Normal');
  const [botLastScores, setBotLastScores] = useState<number[]>([]);
  const [botNames, setBotNames] = useState<string[]>([]);
  const [botPersonalities, setBotPersonalities] = useState<BotPersonality[]>([]);
  const [botTotalScores, setBotTotalScores] = useState<number[]>([]);
  const [botRoundAnswers, setBotRoundAnswers] = useState<BotRoundAnswer[]>([]);
  const [localMatchStandings, setLocalMatchStandings] = useState<MatchStandingEntry[]>([]);
  const [onlineRevealAnswers, setOnlineRevealAnswers] = useState<OnlineRevealAnswer[]>([]);
  const [onlineAnswerVoteRefreshWarning, setOnlineAnswerVoteRefreshWarning] = useState<string | null>(null);
  const [onlineMatchStandings, setOnlineMatchStandings] = useState<OnlineMatchStanding[]>([]);
  const [onlinePlayerRoundHistory, setOnlinePlayerRoundHistory] = useState<OnlinePlayerRoundSummary[]>([]);
  const [onlineRoundScores, setOnlineRoundScores] = useState<OnlineRoundScore[]>([]);
  const [onlineRoundAgreement, setOnlineRoundAgreement] = useState<OnlineRoundAgreement>(EMPTY_ONLINE_ROUND_AGREEMENT);
  const [targetRounds, setTargetRoundsState] = useState(3);
  const [roundSeconds, setRoundSecondsState] = useState(DEFAULT_ROUND_SECONDS);
  const [matchDurationSeconds, setMatchDurationSeconds] = useState<number | null>(null);
  const [matchStartedAtMs, setMatchStartedAtMs] = useState<number | null>(null);
  const [matchTimeRemaining, setMatchTimeRemaining] = useState(0);
  const [activeModeLabel, setActiveModeLabel] = useState('Custom');
  const [activeModeRules, setActiveModeRules] = useState('Set categories, CPUs, rounds, timer, and scoring before play.');
  const [scoringOwner, setScoringOwnerState] = useState<ScoringOwner>('Opponents');
  const [scoringStyle, setScoringStyle] = useState<ScoringStyle>('Classic');
  const [playerProfile, setPlayerProfile] = useState<PlayerProfile>(DEFAULT_PROFILE);
  const [lastMatchResult, setLastMatchResult] = useState<MatchResult | null>(null);
  const [matchResetToken, setMatchResetToken] = useState(0);
  const onlineMatchContextRef = useRef<OnlineMatchContext | null>(null);
  onlineMatchContextRef.current = room?.isOnline && room.id
    ? { generation: matchGenerationRef.current, roomId: room.id, roundId: currentRound?.id ?? null }
    : null;

  function isCurrentOnlineMatchContext(context: OnlineMatchContext) {
    const current = onlineMatchContextRef.current;
    return matchGenerationRef.current === context.generation
      && current?.generation === context.generation
      && current.roomId === context.roomId
      && current.roundId === context.roundId;
  }

  function getOnlineLifecycleContext() {
    return {
      generation: matchGenerationRef.current,
      roomId: onlineMatchContextRef.current?.roomId ?? null,
    };
  }

  const onlineRevealSnapshotKey = room?.isOnline && room.id && currentRound?.id
    ? `${matchGenerationRef.current}:${room.id}:${currentRound.id}`
    : null;
  onlineRevealSnapshotCoordinatorRef.current.ensureKey(onlineRevealSnapshotKey);

  function invalidateOnlineRevealSnapshotRequests() {
    onlineRevealSnapshotCoordinatorRef.current.invalidate();
  }

  function beginOnlineRevealMutation() {
    return onlineRevealSnapshotCoordinatorRef.current.beginMutation();
  }

  function finishOnlineRevealMutation(mutationEpoch: number) {
    onlineRevealSnapshotCoordinatorRef.current.finishMutation(mutationEpoch);
  }

  function invalidateTimeoutFinalization() {
    timeoutFinalizationRef.current = null;
    timeoutFinalizationOwnerRef.current = null;
  }

  function beginOnlineRevealSnapshotRequest(
    roomId: string,
    roundId: string,
    kind: OnlineRevealSnapshotRequestKind = 'poll',
  ): OnlineRevealSnapshotRequest {
    const key = `${matchGenerationRef.current}:${roomId}:${roundId}`;
    return onlineRevealSnapshotCoordinatorRef.current.beginRequest(key, kind);
  }

  function isCurrentOnlineRevealSnapshotRequest(request: OnlineRevealSnapshotRequest) {
    return onlineRevealSnapshotCoordinatorRef.current.isCurrent(request);
  }

  async function readOnlineRevealSnapshot(
    roomId: string,
    roundId: string,
    kind: OnlineRevealSnapshotRequestKind = 'poll',
  ) {
    const request = beginOnlineRevealSnapshotRequest(roomId, roundId, kind);

    try {
      const snapshot = await getOnlineRevealSnapshot(roomId, roundId);
      return {
        request,
        snapshot: isCurrentOnlineRevealSnapshotRequest(request) ? snapshot : null,
      };
    } catch (error) {
      if (!isCurrentOnlineRevealSnapshotRequest(request)) {
        return { request, snapshot: null };
      }
      throw error;
    }
  }

  function setCurrentRound(nextRound: CurrentRound) {
    if (currentRound?.id !== nextRound?.id) {
      invalidateTimeoutFinalization();
    }
    invalidateOnlineRevealSnapshotRequests();
    setCurrentRoundState(nextRound);
  }

  const cleanedRoomCode = useMemo(() => roomCodeInput.trim().toUpperCase(), [roomCodeInput]);
  const answeredCount = useMemo(
    () => selectedCategories.filter((category) => answers[category].trim()).length,
    [answers, selectedCategories],
  );
  const totalScore = useMemo(
    () => room?.isOnline
      ? onlineRoundScores.find((roundScore) => roundScore.playerId === room.playerId)?.score ?? 0
      : selectedCategories.reduce((score, category) => score + scoreAnswer({ verdict: verdicts[category] }), 0),
    [onlineRoundScores, room?.isOnline, room?.playerId, selectedCategories, verdicts],
  );
  const lifetimeScore = useMemo(
    () => roundHistory.reduce((score, round) => score + round.score, 0),
    [roundHistory],
  );
  const botPlayers = useMemo<BotPlayer[]>(
    () => Array.from({ length: botCount }, (_, index) => ({
      id: `bot-${index + 1}`,
      lastScore: botLastScores[index] ?? 0,
      name: botNames[index] ?? `CPU ${index + 1}`,
      personality: botPersonalities[index] ?? 'Agreeable',
      totalScore: botTotalScores[index] ?? 0,
    })),
    [botCount, botLastScores, botNames, botPersonalities, botTotalScores],
  );
  useEffect(() => {
    if (room?.visibility !== 'public' || !room.id || !botCount) return;
    let active = true;
    getOnlineBotRoster(room.id).then((bots) => {
      if (!active) return;
      setBotNames(bots.map((bot) => bot.playerName));
      setBotPersonalities(bots.map((bot) => bot.personality as BotPersonality));
    }).catch((error) => { if (active) setRoomError(error.message); });
    return () => { active = false; };
  }, [room?.id, room?.visibility, botCount]);
  const isMatchComplete = room?.isOnline && room.status === 'finished'
    ? true
    : matchDurationSeconds
      ? matchStartedAtMs !== null && matchTimeRemaining <= 0
      : roundHistory.length >= targetRounds;

  useEffect(() => {
    let isMounted = true;
    let storedNameForStartup = '';

    Promise.all([
      AsyncStorage.getItem(RULES_SEEN_STORAGE_KEY),
      AsyncStorage.getItem(PLAYER_NAME_STORAGE_KEY),
    ])
      .then(async ([rulesSeen, storedPlayerName]) => {
        const cleanStoredName = storedPlayerName?.trim() ?? '';
        storedNameForStartup = cleanStoredName;

        if (cleanStoredName) {
          setPlayerName(cleanStoredName);
          setHasStoredPlayerName(true);
        }

        if (!isMounted) {
          return;
        }

        if (rulesSeen !== 'true') {
          setScreen('rules');
          return;
        }

        setSkipRulesOnLaunch(true);
        const resumedRoom = await resumeOnlineRoom();

        if (!isMounted) {
          return;
        }

        if (resumedRoom) {
          restoreOnlineRoom(resumedRoom);
        } else {
          setScreen(storedNameForStartup ? 'home' : 'nameSetup');
        }
      })
      .catch((error) => {
        if (isMounted) {
          setRoomError(error instanceof Error ? error.message : 'Could not restore the previous session.');
          setScreen(storedNameForStartup ? 'home' : 'nameSetup');
        }
      });

    AsyncStorage.getItem(PROFILE_STORAGE_KEY)
      .then((storedProfile) => {
        if (!storedProfile || !isMounted) {
          return;
        }

        const parsedProfile = JSON.parse(storedProfile) as Partial<PlayerProfile>;

        setPlayerProfile({
          allTimePoints: parsedProfile.allTimePoints ?? 0,
          avatarKey: parsedProfile.avatarKey ?? DEFAULT_PROFILE.avatarKey,
          bestStreak: parsedProfile.bestStreak ?? 0,
          currentStreak: parsedProfile.currentStreak ?? 0,
          gamesPlayed: parsedProfile.gamesPlayed ?? 0,
          recentMatches: Array.isArray(parsedProfile.recentMatches)
            ? parsedProfile.recentMatches.slice(0, 5).map((match, index) => ({
              id: typeof match.id === 'string' ? match.id : `stored-${index}`,
              modeLabel: typeof match.modeLabel === 'string' ? match.modeLabel : 'Brawl',
              playedAt: typeof match.playedAt === 'string' ? match.playedAt : new Date().toISOString(),
              playerRank: typeof match.playerRank === 'number' ? match.playerRank : 1,
              playerScore: typeof match.playerScore === 'number' ? match.playerScore : 0,
              pointsEarned: typeof match.pointsEarned === 'number' ? match.pointsEarned : 0,
              roundsPlayed: typeof match.roundsPlayed === 'number' ? match.roundsPlayed : 0,
              totalPlayers: typeof match.totalPlayers === 'number' ? match.totalPlayers : 1,
              outcome: match.outcome === 'win' ? 'win' : 'loss',
            }))
            : [],
        });
      })
      .catch(() => {
        if (isMounted) {
          setPlayerProfile(DEFAULT_PROFILE);
        }
      });

    AsyncStorage.getItem(LETTER_BAG_STORAGE_KEY)
      .then((storedLetterBag) => {
        if (!storedLetterBag || !isMounted) {
          return;
        }

        setLetterBag(normalizeLetterBag(JSON.parse(storedLetterBag)));
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => () => {
    Object.values(draftSaveTimersRef.current).forEach((timerId) => clearTimeout(timerId));
    draftSaveTimersRef.current = {};
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(playerProfile)).catch(() => undefined);
  }, [playerProfile]);

  useEffect(() => {
    if (playerName.trim()) {
      AsyncStorage.setItem(PLAYER_NAME_STORAGE_KEY, playerName.trim()).catch(() => undefined);
    }
  }, [playerName]);

  useEffect(() => {
    AsyncStorage.setItem(LETTER_BAG_STORAGE_KEY, JSON.stringify(letterBag)).catch(() => undefined);
  }, [letterBag]);

  useEffect(() => {
    if (screen !== 'round' || roundSubmitted) {
      return;
    }

    const timerId = setInterval(() => {
      setTimeRemaining((currentTime) => {
        if (currentTime <= 1) {
          return 0;
        }

        return currentTime - 1;
      });
    }, 1000);

    return () => clearInterval(timerId);
  }, [roundSubmitted, screen]);

  useEffect(() => {
    if (!matchDurationSeconds || !matchStartedAtMs || isMatchComplete) {
      return;
    }

    const timerId = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - matchStartedAtMs) / 1000);
      const nextTimeRemaining = Math.max(0, matchDurationSeconds - elapsedSeconds);

      setMatchTimeRemaining((currentTimeRemaining) => (
        currentTimeRemaining === nextTimeRemaining ? currentTimeRemaining : nextTimeRemaining
      ));
    }, 1000);

    return () => clearInterval(timerId);
  }, [isMatchComplete, matchDurationSeconds, matchStartedAtMs]);

  useEffect(() => {
    if (screen === 'round' && timeRemaining === 0) {
      // Let submitAnswers own the transition. Marking the round submitted
      // here would trip its guard and skip the timeout submission entirely.
      debugGameEvent('round-timeout', { roundId: currentRound?.id, roundLetter });
      void submitAnswers();
    }
  }, [currentRound?.id, roundLetter, screen, timeRemaining]);

  useEffect(() => {
    if (
      screen === 'round'
      && room?.isOnline
      && timeRemaining === 1
      && !roundSubmitted
      && !isRoundBusy
      && currentRound?.id
    ) {
      debugGameEvent('round-autosubmit-before-timeout', { roundId: currentRound.id, roundLetter });
      void submitAnswers();
    }
  }, [currentRound?.id, isRoundBusy, room?.isOnline, roundLetter, roundSubmitted, screen, timeRemaining]);

  useEffect(() => {
    if (!room?.isOnline || !room.id) {
      return;
    }

    let isMounted = true;
    const context: OnlineMatchContext = {
      generation: matchGenerationRef.current,
      roomId: room.id,
      roundId: currentRound?.id ?? null,
    };

    async function syncRoomState() {
      if (!room?.id) {
        return;
      }

      try {
        const snapshot = await getOnlineRoomSnapshot(room.id, room.playerId);

        if (!isMounted || !isCurrentOnlineMatchContext(context)) {
          return;
        }

        setRoom((currentRoom) => {
          if (!currentRoom || currentRoom.id !== room.id) {
            return currentRoom;
          }

          const currentPlayerNames = currentRoom.playerNames ?? [currentRoom.playerName];
          const nextPlayerNames = snapshot.playerNames ?? currentPlayerNames;
          const nextRoom = {
            ...currentRoom,
            expiresAt: snapshot.expiresAt,
            hostName: snapshot.hostName,
            isHost: snapshot.hostPlayerId === currentRoom.playerId,
            letterPickerName: snapshot.letterPickerName,
            letterPickerPlayerId: snapshot.letterPickerPlayerId,
            playerCount: snapshot.playerCount,
            playerNames: nextPlayerNames,
            settings: snapshot.settings,
            setupLocked: snapshot.setupLocked,
            status: snapshot.status,
            spectatorCount: snapshot.spectatorCount,
          };

          return nextRoom.expiresAt === currentRoom.expiresAt
            && nextRoom.hostName === currentRoom.hostName
            && nextRoom.isHost === currentRoom.isHost
            && nextRoom.letterPickerName === currentRoom.letterPickerName
            && nextRoom.letterPickerPlayerId === currentRoom.letterPickerPlayerId
            && nextRoom.playerCount === currentRoom.playerCount
            && nextPlayerNames.join('|') === currentPlayerNames.join('|')
            && JSON.stringify(nextRoom.settings) === JSON.stringify(currentRoom.settings)
            && nextRoom.setupLocked === currentRoom.setupLocked
            && nextRoom.status === currentRoom.status
            && nextRoom.spectatorCount === currentRoom.spectatorCount
            ? currentRoom
            : nextRoom;
        });
        if (!editSnapshotRef.current) applySyncedRoomSettings(snapshot.settings);

        if (snapshot.isExpired) {
          setRoomExpiredNotice(true);
          return;
        }

        if (!snapshot.activeRound) {
          if ((screen === 'reveal' || screen === 'scoring') && (snapshot.status === 'lobby' || snapshot.status === 'finished')) {
            const syncedMatchState = await syncOnlineMatchState();
            if (!isMounted || !syncedMatchState.isCurrent || !isCurrentOnlineMatchContext(context)) {
              return;
            }
            const syncedPlayerStanding = syncedMatchState.standings.find((standing) => (
              standing.playerId === room.playerId
            ));

            if (snapshot.status === 'finished' && syncedPlayerStanding) {
              const playerRank = Math.max(1, syncedMatchState.standings.findIndex((standing) => (
                standing.playerId === room.playerId
              )) + 1);

              setLastMatchResult({
                achievementUnlockedLabels: [],
                isWinner: playerRank === 1,
                playerRank,
                playerScore: syncedPlayerStanding.totalScore,
                pointsEarned: syncedPlayerStanding.lastRoundScore,
                totalPlayers: syncedMatchState.standings.length,
              });
            }

            setScreen('leaderboard');
          }

          return;
        }

        if (currentRound?.id === snapshot.activeRound.id) {
          if (snapshot.activeRound.status === 'active') {
            const nextTimeRemaining = getRemainingSeconds(snapshot.activeRound.endsAt);

            setTimeRemaining((currentTimeRemaining) => (
              currentTimeRemaining === nextTimeRemaining ? currentTimeRemaining : nextTimeRemaining
            ));
          } else if (snapshot.activeRound.status === 'revealing') {
            setRoundSubmitted(true);
            if (screen === 'round') {
              setScreen('reveal');
            }
          }

          return;
        }

        if (
          !['active', 'revealing'].includes(snapshot.activeRound.status ?? '')
          || (screen !== 'lobby' && screen !== 'leaderboard')
        ) {
          return;
        }

        const hydrationContext: OnlineMatchContext = {
          ...context,
          roundId: snapshot.activeRound.id,
        };
        const restoredAnswers = room.playerId
          ? await getOnlinePlayerAnswers(snapshot.activeRound.id, room.playerId)
          : {};
        const currentContext = onlineMatchContextRef.current;
        if (
          !isMounted
          || !isCurrentOnlineMatchContext(context)
          || (currentContext?.roundId !== context.roundId)
        ) {
          return;
        }
        const nextAnswers = {
          ...createEmptyAnswers(),
          ...restoredAnswers,
        };
        const restoredCategories = STARTER_CATEGORIES.filter((category) => (
          Object.prototype.hasOwnProperty.call(restoredAnswers, category)
        ));

        setCurrentRound(snapshot.activeRound);
        setLetterBag((currentLetters) => removeLetterFromBag(currentLetters, snapshot.activeRound?.letter ?? ''));
        setRoundLetter(snapshot.activeRound.letter);
        setTimeRemaining(getRemainingSeconds(snapshot.activeRound.endsAt));
        setAnswers(nextAnswers);
        setVerdicts(createVerdictsFromAnswers(nextAnswers, snapshot.activeRound.letter, scoringStyle));
        if (restoredCategories.length) {
          setSelectedCategories(restoredCategories);
        }
        setOnlineRevealAnswers([]);
        setLocalMatchStandings([]);
        setOnlineMatchStandings([]);
        setOnlinePlayerRoundHistory([]);
        setOnlineRoundScores([]);
        setOnlineRoundAgreement(EMPTY_ONLINE_ROUND_AGREEMENT);
        setRoundSubmitted(snapshot.activeRound.status === 'revealing');
        setRoomError('');
        setScreen(snapshot.activeRound.status === 'revealing' ? 'reveal' : 'round');
      } catch (error) {
        if (isMounted && isCurrentOnlineMatchContext(context)) {
          setRoomError(error instanceof Error ? error.message : 'Could not sync session.');
        }
      }
    }

    syncRoomState();

    const syncIntervalId = setInterval(syncRoomState, ROOM_SYNC_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(syncIntervalId);
    };
  }, [currentRound?.id, room?.id, room?.isOnline, screen]);

  useEffect(() => {
    if (room?.visibility !== 'public' || room.status !== 'lobby' || screen !== 'lobby' || currentRound) {
      setLiveTableCountdownRemaining(null);
      return;
    }

    const lobbyEnteredAtMs = Date.now();
    setLiveTableCountdownRemaining(REAL_PLAYER_WAIT_MS / 1000);
    const timeout = setTimeout(() => setLiveTableCountdownRemaining(0), remainingSearchMs(lobbyEnteredAtMs));
    return () => clearTimeout(timeout);
  }, [currentRound?.id, room?.id, room?.status, room?.visibility, roundHistory.length, screen]);

  useEffect(() => {
    const effectiveLiveTablePlayerCount = (room?.playerCount ?? 0) + botCount;
    const isLiveTableReadyToStart = effectiveLiveTablePlayerCount >= LIVE_TABLE_TARGET_PLAYERS;

    if (
      (!isLiveTableReadyToStart && liveTableCountdownRemaining !== 0)
      || room?.visibility !== 'public'
      || !room.id
      || !room.playerId
      || room.status !== 'lobby'
      || screen !== 'lobby'
      || currentRound
      || isRoundBusy
      || isMatchComplete
    ) {
      return;
    }

    const autoStartKey = `${room.id}:${roundHistory.length}:${room.playerCount}:${botCount}:${isLiveTableReadyToStart ? 'ready' : 'fill'}`;

    if (liveAdvanceInFlight.current || liveTableAutoStartKey === autoStartKey) {
      return;
    }

    liveAdvanceInFlight.current = true;
    const generation = matchGenerationRef.current;
    setLiveTableAutoStartKey(autoStartKey);

    const nextLetter = pickNextLetterFromBag(letterBag);
    const nextAnswers = createEmptyAnswers();

    setIsRoundBusy(true);
    advanceLiveBrawlSession({
      letter: nextLetter,
      playerId: room.playerId,
      roomId: room.id,
      roundSeconds,
      targetPlayers: LIVE_TABLE_TARGET_PLAYERS,
    })
      .then((result) => {
        if (generation !== matchGenerationRef.current) return;
        setBotCount(result.botCount, false);
        setRoom((currentRoom) => currentRoom && currentRoom.id === room.id
          ? {
            ...currentRoom,
            settings: {
              ...currentRoom.settings,
              botCount: result.botCount,
            },
            setupLocked: Boolean(result.round) || currentRoom.setupLocked,
            status: result.round ? 'in_round' : result.roomStatus,
          }
          : currentRoom);

        if (!result.round) {
          setLiveTableCountdownRemaining(LIVE_TABLE_BOT_FILL_INTERVAL_SECONDS);
          liveRetryTimer.current = setTimeout(() => {
            if (generation !== matchGenerationRef.current) return;
            setLiveTableAutoStartKey('');
            setLiveTableCountdownRemaining(0);
          }, REAL_PLAYER_WAIT_MS);
          return;
        }

        setCurrentRound(result.round);
        setLetterBag((currentLetters) => removeLetterFromBag(currentLetters, result.round!.letter));
        setMatchStartedAtMs((currentStartedAt) => (
          matchDurationSeconds && !currentStartedAt ? Date.now() : currentStartedAt
        ));
        setRoundLetter(result.round.letter);
        setManualRoundLetter('');
        setTimeRemaining(getRemainingSeconds(result.round.endsAt, roundSeconds));
        setAnswers(nextAnswers);
        setVerdicts(createVerdictsFromAnswers(nextAnswers, result.round.letter, scoringStyle));
        setBotRoundAnswers([]);
        setOnlineRevealAnswers([]);
        setOnlineMatchStandings([]);
        setOnlinePlayerRoundHistory([]);
        setOnlineRoundScores([]);
        setOnlineRoundAgreement(EMPTY_ONLINE_ROUND_AGREEMENT);
        setRoundSubmitted(false);
        setScreen('round');
      })
      .catch((error) => {
        if (generation !== matchGenerationRef.current) return;
        setRoomError(error instanceof Error ? error.message : 'Could not prepare Live Brawl.');
      })
      .finally(() => {
        liveAdvanceInFlight.current = false;
        setIsRoundBusy(false);
      });
  }, [
    currentRound,
    isMatchComplete,
    isRoundBusy,
    botCount,
    letterBag,
    liveTableAutoStartKey,
    liveTableCountdownRemaining,
    matchDurationSeconds,
    room?.id,
    room?.playerCount,
    room?.playerId,
    room?.status,
    room?.visibility,
    roundHistory.length,
    roundSeconds,
    screen,
    scoringStyle,
  ]);

  function restoreOnlineRoom(onlineRoom: OnlineResumeResult) {
    setRoom({
      code: onlineRoom.code,
      expiresAt: onlineRoom.expiresAt,
      hostName: onlineRoom.hostName,
      id: onlineRoom.id,
      isHost: onlineRoom.isHost,
      isOnline: true,
      letterPickerName: onlineRoom.letterPickerName,
      letterPickerPlayerId: onlineRoom.letterPickerPlayerId,
      playerCount: onlineRoom.playerCount,
      playerId: onlineRoom.playerId,
      playerNames: onlineRoom.playerNames,
      playerName: onlineRoom.playerName,
      settings: onlineRoom.settings,
      setupLocked: onlineRoom.setupLocked,
      status: onlineRoom.status,
      spectatorCount: onlineRoom.spectatorCount,
      visibility: onlineRoom.visibility,
    });
    applySyncedRoomSettings(onlineRoom.settings);

    setRoomCodeInput(onlineRoom.code);
    setOnlineRevealAnswers([]);
    setOnlineAnswerVoteRefreshWarning(null);
    setOnlineMatchStandings([]);
    setOnlinePlayerRoundHistory([]);
    setOnlineRoundScores([]);
    setOnlineRoundAgreement(EMPTY_ONLINE_ROUND_AGREEMENT);

    if (!onlineRoom.activeRound) {
      setCurrentRound(null);
      setRoundSubmitted(false);
      setRoomRejoinedNotice(true);
      setScreen('lobby');
      return;
    }

    const restoredAnswers = {
      ...createEmptyAnswers(),
      ...onlineRoom.answers,
    };
    const restoredCategories = STARTER_CATEGORIES.filter((category) => (
      Object.prototype.hasOwnProperty.call(onlineRoom.answers, category)
    ));

    setCurrentRound(onlineRoom.activeRound);
    setLetterBag((currentLetters) => removeLetterFromBag(currentLetters, onlineRoom.activeRound?.letter ?? ''));
    setRoundLetter(onlineRoom.activeRound.letter);
    setTimeRemaining(getRemainingSeconds(onlineRoom.activeRound.endsAt, roundSeconds));
    setAnswers(restoredAnswers);
    setVerdicts(createVerdictsFromAnswers(restoredAnswers, onlineRoom.activeRound.letter, scoringStyle));
    if (restoredCategories.length) {
      setSelectedCategories(restoredCategories);
    }
    setRoundSubmitted(onlineRoom.activeRound.status === 'revealing');
    setRoomRejoinedNotice(true);
    setScreen(onlineRoom.activeRound.status === 'revealing' ? 'reveal' : 'round');
    emitQaTelemetry('client.rejoined-round', {
      roomId: room?.id,
      roundId: onlineRoom.activeRound.id,
      roundStatus: onlineRoom.activeRound.status,
      screen: onlineRoom.activeRound.status === 'revealing' ? 'reveal' : 'round',
    });
  }

  useEffect(() => {
    if (!room?.isOnline || !room.id || !currentRound?.id || (screen !== 'reveal' && screen !== 'scoring' && screen !== 'leaderboard')) {
      return;
    }

    let isMounted = true;
    const context: OnlineMatchContext = {
      generation: matchGenerationRef.current,
      roomId: room.id,
      roundId: currentRound.id,
    };

    async function syncRevealSnapshot() {
      if (!room?.id || !currentRound?.id) {
        return;
      }

      try {
        const { request, snapshot } = await readOnlineRevealSnapshot(room.id, currentRound.id);

        if (!isMounted || !snapshot || !isCurrentOnlineRevealSnapshotRequest(request)) {
          return;
        }

        let botSnapshot: OnlineBotRoundSnapshot | null = null;
        if (room.visibility === 'public' && (snapshot.submittedPlayerCount >= snapshot.activePlayerCount || timeRemaining <= 0)) {
          botSnapshot = await getOnlineBotRoundSnapshot(room.id, currentRound.id);
        }
        let syncedMatchState: Awaited<ReturnType<typeof syncOnlineMatchState>> | null = null;
        if (
          screen === 'leaderboard'
          || Date.now() - lastOnlineMatchSyncAtRef.current >= MATCH_STATE_SYNC_INTERVAL_MS
        ) {
          syncedMatchState = await syncOnlineMatchState(false);
        }
        if (!isMounted || !isCurrentOnlineRevealSnapshotRequest(request)) {
          return;
        }
        setOnlineRevealAnswers(snapshot.answers);
        setOnlineAnswerVoteRefreshWarning(null);
        if (botSnapshot) {
          applyOnlineBotSnapshot(botSnapshot);
        }
        if (syncedMatchState) {
          applyOnlineMatchState(syncedMatchState.standings, syncedMatchState.history);
          lastOnlineMatchSyncAtRef.current = Date.now();
        }
        setOnlineRoundScores(snapshot.scores);
        setOnlineRoundAgreement(getOnlineRoundAgreement(snapshot));
        emitQaTelemetry('client.reveal-sync', {
          activePlayerCount: snapshot.activePlayerCount,
          disputeEndsAt: snapshot.disputeEndsAt ?? null,
          expectedVoteCount: snapshot.expectedVoteCount,
          openDisputeCount: snapshot.openDisputeCount,
          phase: getTimeoutPhase({
            activePlayerCount: snapshot.activePlayerCount,
            expectedVoteCount: snapshot.expectedVoteCount,
            openDisputeCount: snapshot.openDisputeCount,
            submittedPlayerCount: snapshot.submittedPlayerCount,
            voteCount: snapshot.voteCount,
          }),
          roomId: room.id,
          roundId: currentRound.id,
          scoreCount: snapshot.scores.length,
          scoringEndsAt: snapshot.scoringEndsAt ?? null,
          screen,
          submittedPlayerCount: snapshot.submittedPlayerCount,
          voteCount: snapshot.voteCount,
        });
      } catch (error) {
        if (isMounted && isCurrentOnlineMatchContext(context)) {
          setRoomError(error instanceof Error ? error.message : 'Could not sync scores.');
          emitQaTelemetry('client.sync-error', {
            message: error instanceof Error ? error.message : 'Could not sync scores.',
            roomId: room.id,
            roundId: currentRound.id,
            screen,
          });
        }
      }
    }

    syncRevealSnapshot();

    const syncIntervalId = setInterval(syncRevealSnapshot, REVEAL_SYNC_INTERVAL_MS);

    return () => {
      isMounted = false;
      clearInterval(syncIntervalId);
    };
  }, [currentRound?.id, room?.id, room?.isOnline, screen]);

  useEffect(() => {
    if (!room?.isOnline || !currentRound?.id || isRoundBusy || (screen !== 'reveal' && screen !== 'scoring')) {
      return undefined;
    }

    const phase = getTimeoutPhase({
      activePlayerCount: onlineRoundAgreement.activePlayerCount,
      expectedVoteCount: onlineRoundAgreement.expectedVoteCount,
      openDisputeCount: onlineRoundAgreement.openDisputeCount,
      submittedPlayerCount: onlineRoundAgreement.submittedPlayerCount,
      voteCount: onlineRoundAgreement.voteCount,
    });

    const deadlineIso = getPhaseDeadline(phase, {
      disputeEndsAt: onlineRoundAgreement.disputeEndsAt,
      scoringEndsAt: onlineRoundAgreement.scoringEndsAt,
    });
    const remainingSeconds = getDeadlineRemainingSeconds(deadlineIso);

    if (phase === 'complete' || remainingSeconds === null) {
      return undefined;
    }

    if (remainingSeconds <= 0) {
      void finalizeTimedOutRound();
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      void finalizeTimedOutRound();
    }, (remainingSeconds * 1000) + 100);

    return () => clearTimeout(timeoutId);
  }, [
    currentRound?.id,
    isRoundBusy,
    onlineRoundAgreement.activePlayerCount,
    onlineRoundAgreement.disputeEndsAt,
    onlineRoundAgreement.expectedVoteCount,
    onlineRoundAgreement.openDisputeCount,
    onlineRoundAgreement.scoringEndsAt,
    onlineRoundAgreement.submittedPlayerCount,
    onlineRoundAgreement.voteCount,
    room?.isOnline,
    screen,
  ]);

  function applyOnlineMatchState(
    nextStandings: OnlineMatchStanding[],
    nextRoundHistory: OnlinePlayerRoundSummary[],
  ) {
    setOnlineMatchStandings(nextStandings);
    setOnlinePlayerRoundHistory(nextRoundHistory);
    setRoundHistory(nextRoundHistory.map((round) => ({
      answeredCount: round.answeredCount,
      categoryCount: selectedCategories.length,
      id: round.roundId,
      letter: round.letter,
      roundNumber: round.roundNumber,
      score: round.score,
    })));
  }

  async function syncOnlineMatchState(commit = true) {
    if (!room?.isOnline || !room.id || !room.playerId) {
      return {
        history: [] as OnlinePlayerRoundSummary[],
        standings: [] as OnlineMatchStanding[],
        isCurrent: true,
      };
    }

    const context: OnlineMatchContext = {
      generation: matchGenerationRef.current,
      roomId: room.id,
      roundId: currentRound?.id ?? null,
    };

    const [nextStandings, nextRoundHistory] = await Promise.all([
      getOnlineMatchStandings(room.id),
      getOnlinePlayerRoundHistory(room.id, room.playerId),
    ]);

    const isCurrent = isCurrentOnlineMatchContext(context);
    if (commit && isCurrent) {
      applyOnlineMatchState(nextStandings, nextRoundHistory);
    }

    return {
      history: nextRoundHistory,
      standings: nextStandings,
      isCurrent,
    };
  }

  async function createRoom(modeSetup?: GameModeSetup) {
    if (room) {
      setRoomError(`Session ${room.code} is still open. Close it before creating a new one.`);
      setScreen('lobby');
      return;
    }

    const name = ensurePlayerName();
    const roomSettings = modeSetup ? getModeSetupRoomSettings(modeSetup) : getRoomSettings();

    setIsRoomBusy(true);
    setRoomError('');

    try {
      if (modeSetup) {
        applyModeSetup(modeSetup);
      }

      const onlineRoom = await createOnlineRoom(name, roomSettings);

      setRoom({
        code: onlineRoom.code,
        expiresAt: onlineRoom.expiresAt,
        hostName: onlineRoom.hostName,
        id: onlineRoom.id,
        isHost: onlineRoom.isHost,
        isOnline: true,
        letterPickerName: onlineRoom.letterPickerName,
        letterPickerPlayerId: onlineRoom.letterPickerPlayerId,
        playerCount: onlineRoom.playerCount,
        playerId: onlineRoom.playerId,
        playerNames: onlineRoom.playerNames,
        playerName: onlineRoom.playerName,
        settings: onlineRoom.settings,
        setupLocked: onlineRoom.setupLocked,
        status: onlineRoom.status,
        spectatorCount: onlineRoom.spectatorCount,
        visibility: onlineRoom.visibility,
      });
      setScreen('lobby');
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not create session.');
    } finally {
      setIsRoomBusy(false);
    }
  }

  function startPractice(modeSetup: GameModeSetup) {
    if (room) {
      setRoomError(`Session ${room.code} is still open. Close it before starting Practice.`);
      return;
    }

    const name = ensurePlayerName();
    const settings = getModeSetupRoomSettings(modeSetup);
    const nextBotNames = pickBotNames(modeSetup.botCount, []);
    const nextBotPersonalities = pickBotPersonalities(modeSetup.botCount, []);
    const nextLetter = pickNextLetterFromBag(LETTER_POOL);
    const nextRound = {
      id: `local-practice-${Date.now()}-${nextLetter}`,
      letter: nextLetter,
      roundNumber: 1,
    };
    const nextRoom: LocalRoom = {
      code: '',
      hostName: name,
      isOnline: false,
      isHost: true,
      playerCount: 1,
      playerNames: [name, ...nextBotNames],
      playerName: name,
      settings,
      setupLocked: true,
      status: 'in_round',
      spectatorCount: 0,
      visibility: 'private',
    };

    matchGenerationRef.current += 1;
    completedMatchRecordedRef.current = false;
    invalidateOnlineRevealSnapshotRequests();
    roundSubmissionRef.current = null;
    roundSubmissionOwnerRef.current = null;
    invalidateTimeoutFinalization();
    applyModeSetup(modeSetup);
    setRoomError('');
    setIsRoundBusy(false);
    setRoom(nextRoom);
    setCurrentRound(nextRound);
    setLetterBag(removeLetterFromBag(LETTER_POOL, nextLetter));
    setRoundLetter(nextLetter);
    setManualRoundLetter('');
    setTimeRemaining(modeSetup.roundSeconds);
    setAnswers(createEmptyAnswers());
    setVerdicts(createVerdictsFromAnswers(createEmptyAnswers(), nextLetter, modeSetup.scoringStyle));
    setRoundHistory([]);
    setRoundSubmitted(false);
    setBotNames(nextBotNames);
    setBotPersonalities(nextBotPersonalities);
    setBotLastScores(Array.from({ length: modeSetup.botCount }, () => 0));
    setBotTotalScores(Array.from({ length: modeSetup.botCount }, () => 0));
    setBotRoundAnswers([]);
    setLocalMatchStandings([]);
    setOnlineRevealAnswers([]);
    setOnlineAnswerVoteRefreshWarning(null);
    setOnlineMatchStandings([]);
    setOnlinePlayerRoundHistory([]);
    setOnlineRoundScores([]);
    setOnlineRoundAgreement(EMPTY_ONLINE_ROUND_AGREEMENT);
    setMatchStartedAtMs(null);
    setMatchTimeRemaining(0);
    setLastMatchResult(null);
    setScreen('round');
  }

  function joinLiveTable() { return joinFlight.current(runLiveJoin); }

  async function runLiveJoin() {
    if (room) {
      setRoomError(`Session ${room.code} is still open. Close it before joining Live Brawl.`);
      setScreen('lobby');
      return;
    }

    const name = ensurePlayerName();
    const roomSettings = getModeSetupRoomSettings(LIVE_TABLE_SETUP);

    setIsRoomBusy(true);
    setRoomError('');

    try {
      applyModeSetup(LIVE_TABLE_SETUP);
      const onlineRoom = await findOrCreatePublicRoom(name, roomSettings, {
        matchmakingBucket: getLiveBrawlMatchmakingBucket(playerProfile),
        maxPlayers: LIVE_TABLE_TARGET_PLAYERS,
        minClientVersion: LIVE_BRAWL_CLIENT_VERSION,
        rulesetVersion: LIVE_BRAWL_RULESET_VERSION,
      });

      setRoom({
        code: onlineRoom.code,
        expiresAt: onlineRoom.expiresAt,
        hostName: onlineRoom.hostName,
        id: onlineRoom.id,
        isHost: onlineRoom.isHost,
        isOnline: true,
        letterPickerName: onlineRoom.letterPickerName,
        letterPickerPlayerId: onlineRoom.letterPickerPlayerId,
        playerCount: onlineRoom.playerCount,
        playerId: onlineRoom.playerId,
        playerNames: onlineRoom.playerNames,
        playerName: onlineRoom.playerName,
        settings: onlineRoom.settings,
        setupLocked: onlineRoom.setupLocked,
        status: onlineRoom.status,
        spectatorCount: onlineRoom.spectatorCount,
        visibility: onlineRoom.visibility,
      });
      applySyncedRoomSettings(onlineRoom.settings);
      setRoomCodeInput('');
      setScreen('lobby');
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not join Live Brawl.');
    } finally {
      setIsRoomBusy(false);
    }
  }

  async function joinRoom() {
    if (room) {
      setRoomError(`Session ${room.code} is still open. Close it before joining another session.`);
      setScreen('lobby');
      return;
    }

    if (!cleanedRoomCode) {
      return;
    }

    const name = ensurePlayerName();
    const joinGeneration = matchGenerationRef.current;
    const isCurrentJoin = () => matchGenerationRef.current === joinGeneration
      && onlineMatchContextRef.current === null;

    setIsRoomBusy(true);
    setRoomError('');

    try {
      const onlineRoom = await joinOnlineRoom(cleanedRoomCode, name);
      if (!isCurrentJoin()) {
        return;
      }
      const activeRound = await getOnlineRoomSnapshot(onlineRoom.id, onlineRoom.playerId)
        .then((snapshot) => snapshot.activeRound);
      if (!isCurrentJoin()) {
        return;
      }
      const restoredAnswers = activeRound
        ? await getOnlinePlayerAnswers(activeRound.id, onlineRoom.playerId)
        : {};
      if (!isCurrentJoin()) {
        return;
      }

      setRoom({
        code: onlineRoom.code,
        expiresAt: onlineRoom.expiresAt,
        hostName: onlineRoom.hostName,
        id: onlineRoom.id,
        isHost: onlineRoom.isHost,
        isOnline: true,
        letterPickerName: onlineRoom.letterPickerName,
        letterPickerPlayerId: onlineRoom.letterPickerPlayerId,
        playerCount: onlineRoom.playerCount,
        playerId: onlineRoom.playerId,
        playerNames: onlineRoom.playerNames,
        playerName: onlineRoom.playerName,
        settings: onlineRoom.settings,
        setupLocked: onlineRoom.setupLocked,
        status: onlineRoom.status,
        spectatorCount: onlineRoom.spectatorCount,
        visibility: onlineRoom.visibility,
      });
      applySyncedRoomSettings(onlineRoom.settings);

      if (activeRound) {
        const nextAnswers = {
          ...createEmptyAnswers(),
          ...restoredAnswers,
        };
        const restoredCategories = STARTER_CATEGORIES.filter((category) => (
          Object.prototype.hasOwnProperty.call(restoredAnswers, category)
        ));

        setCurrentRound(activeRound);
        setLetterBag((currentLetters) => removeLetterFromBag(currentLetters, activeRound.letter));
        setRoundLetter(activeRound.letter);
        setTimeRemaining(getRemainingSeconds(activeRound.endsAt, roundSeconds));
        setAnswers(nextAnswers);
        setVerdicts(createVerdictsFromAnswers(nextAnswers, activeRound.letter, scoringStyle));
        if (restoredCategories.length) {
          setSelectedCategories(restoredCategories);
        }
        setRoundSubmitted(activeRound.status === 'revealing');
        setRoomRejoinedNotice(true);
        setScreen(activeRound.status === 'revealing' ? 'reveal' : 'round');
      } else {
        setScreen('lobby');
      }
    } catch (error) {
      if (isCurrentJoin()) {
        setRoomError(error instanceof Error ? error.message : 'Could not join session.');
      }
    } finally {
      setIsRoomBusy(false);
    }
  }

  async function leaveRoom() {
    editSnapshotRef.current = null;
    setIsEditingBrawl(false);
    const roomToLeave = room;
    matchGenerationRef.current += 1;
    completedMatchRecordedRef.current = false;
    invalidateOnlineRevealSnapshotRequests();
    roundSubmissionRef.current = null;
    roundSubmissionOwnerRef.current = null;
    invalidateTimeoutFinalization();
    setIsRoundBusy(false);
    Object.values(draftSaveTimersRef.current).forEach((timerId) => clearTimeout(timerId));
    draftSaveTimersRef.current = {};

    if (roomToLeave?.isOnline && roomToLeave.playerId) {
      try {
        await leaveOnlineRoom(roomToLeave.playerId);
      } catch (error) {
        setRoomError(error instanceof Error ? error.message : 'Could not leave session cleanly.');
      }
    }

    setRoom(null);
    setRoomExpiredNotice(false);
    setRoomError('');
    setRoomCodeInput('');
    setCurrentRound(null);
    setRoundLetter('');
    setTimeRemaining(roundSeconds);
    setAnswers(createEmptyAnswers());
    setVerdicts(createVerdictsFromAnswers(createEmptyAnswers()));
    setSelectedCategories([...STARTER_CATEGORIES]);
    setRoundHistory([]);
    setRoundSubmitted(false);
    setBotLastScores([]);
    setBotNames([]);
    setBotPersonalities([]);
    setBotTotalScores([]);
    setBotRoundAnswers([]);
    setLocalMatchStandings([]);
    setOnlineRevealAnswers([]);
    setOnlineAnswerVoteRefreshWarning(null);
    setOnlineMatchStandings([]);
    setOnlinePlayerRoundHistory([]);
    setOnlineRoundScores([]);
    setOnlineRoundAgreement(EMPTY_ONLINE_ROUND_AGREEMENT);
    setTargetRoundsState(3);
    setMatchDurationSeconds(null);
    setMatchStartedAtMs(null);
    setMatchTimeRemaining(0);
    setLastMatchResult(null);
    setScoringOwnerState('Opponents');
    setScreen('home');
  }

  async function performResetMatch() {
    editSnapshotRef.current = null;
    setIsEditingBrawl(false);
    const previousRoom = room;
    const shouldCreateFreshOnlineRoom = Boolean(previousRoom?.isOnline);
    const resetGeneration = ++matchGenerationRef.current;
    completedMatchRecordedRef.current = false;
    invalidateOnlineRevealSnapshotRequests();
    roundSubmissionRef.current = null;
    roundSubmissionOwnerRef.current = null;
    invalidateTimeoutFinalization();
    setIsRoundBusy(false);
    Object.values(draftSaveTimersRef.current).forEach((timerId) => clearTimeout(timerId));
    draftSaveTimersRef.current = {};

    // Do not leave the completed room reconnectable. Otherwise the startup
    // resume path can restore the old match after Play Again creates a new one.
    setRoom(null);
    setRoomExpiredNotice(false);
    setRoomRejoinedNotice(false);
    setRoomCodeInput('');
    setRoomError('');
    setMatchResetToken((currentToken) => currentToken + 1);
    setCurrentRound(null);
    setRoundLetter('');
    setTimeRemaining(roundSeconds);
    setLetterBag(LETTER_POOL);
    setAnswers(createEmptyAnswers());
    setVerdicts(createVerdictsFromAnswers(createEmptyAnswers()));
    setRoundHistory([]);
    setRoundSubmitted(false);
    setBotLastScores([]);
    setBotTotalScores([]);
    setBotNames(pickBotNames(botCount, []));
    setBotPersonalities(pickBotPersonalities(botCount, []));
    setBotRoundAnswers([]);
    setLocalMatchStandings([]);
    setOnlineRevealAnswers([]);
    setOnlineAnswerVoteRefreshWarning(null);
    setOnlineMatchStandings([]);
    setOnlinePlayerRoundHistory([]);
    setOnlineRoundScores([]);
    setOnlineRoundAgreement(EMPTY_ONLINE_ROUND_AGREEMENT);
    setMatchStartedAtMs(null);
    setMatchTimeRemaining(matchDurationSeconds ?? 0);
    setLastMatchResult(null);

    if (previousRoom && !previousRoom.isOnline) {
      // Practice replay must create a new local round. Leaving the room null
      // and navigating to the lobby renders no playable session on web.
      const nextLetter = pickNextLetterFromBag(LETTER_POOL);
      const nextRound = {
        id: `local-practice-${Date.now()}-${nextLetter}`,
        letter: nextLetter,
        roundNumber: 1,
      };
      setRoom({ ...previousRoom, status: 'in_round' });
      setCurrentRound(nextRound);
      setLetterBag(removeLetterFromBag(LETTER_POOL, nextLetter));
      setRoundLetter(nextLetter);
      setTimeRemaining(roundSeconds);
      setVerdicts(createVerdictsFromAnswers(createEmptyAnswers(), nextLetter, scoringStyle));
      setScreen('round');
      return;
    }

    if (shouldCreateFreshOnlineRoom) {
      setIsRoomBusy(true);
      setRoomError('');

      try {
        if (previousRoom?.playerId) {
          try {
            await leaveOnlineRoom(previousRoom.playerId);
          } catch (error) {
            // A failed cleanup must not prevent starting a fresh match.
            setRoomError(error instanceof Error ? error.message : 'Could not close the previous session cleanly.');
          }
        }

        if (matchGenerationRef.current !== resetGeneration) {
          return;
        }

        const isPublicRoomRestart = previousRoom?.visibility === 'public';
        const onlineRoom = await createOnlineRoom(ensurePlayerName(), getRoomSettings(), {
          expiresInMinutes: isPublicRoomRestart ? 10 : 15,
          matchmakingBucket: isPublicRoomRestart ? getLiveBrawlMatchmakingBucket(playerProfile) : undefined,
          maxPlayers: isPublicRoomRestart ? LIVE_TABLE_TARGET_PLAYERS : 8,
          minClientVersion: isPublicRoomRestart ? LIVE_BRAWL_CLIENT_VERSION : undefined,
          rulesetVersion: isPublicRoomRestart ? LIVE_BRAWL_RULESET_VERSION : undefined,
          visibility: previousRoom?.visibility ?? 'private',
        });

        if (matchGenerationRef.current !== resetGeneration) {
          await leaveOnlineRoom(onlineRoom.playerId);
          return;
        }

        setRoom({
          code: onlineRoom.code,
          expiresAt: onlineRoom.expiresAt,
          hostName: onlineRoom.hostName,
          id: onlineRoom.id,
          isHost: onlineRoom.isHost,
          isOnline: true,
          letterPickerName: onlineRoom.letterPickerName,
          letterPickerPlayerId: onlineRoom.letterPickerPlayerId,
          playerCount: onlineRoom.playerCount,
          playerId: onlineRoom.playerId,
          playerNames: onlineRoom.playerNames,
          playerName: onlineRoom.playerName,
          settings: onlineRoom.settings,
          setupLocked: onlineRoom.setupLocked,
          status: onlineRoom.status,
          spectatorCount: onlineRoom.spectatorCount,
          visibility: onlineRoom.visibility,
        });
        setRoomCodeInput(onlineRoom.code);
      } catch (error) {
        setRoomError(error instanceof Error ? error.message : 'Could not restart session.');
      } finally {
        setIsRoomBusy(false);
      }
    }

    setScreen('lobby');
  }

  function resetMatch() {
    if (matchResetInFlightRef.current) {
      return matchResetInFlightRef.current;
    }

    const resetPromise = performResetMatch();
    matchResetInFlightRef.current = resetPromise;
    void resetPromise.then(
      () => {
        if (matchResetInFlightRef.current === resetPromise) {
          matchResetInFlightRef.current = null;
        }
      },
      () => {
        if (matchResetInFlightRef.current === resetPromise) {
          matchResetInFlightRef.current = null;
        }
      },
    );
    return resetPromise;
  }

  function setBotCount(nextBotCount: number, shouldSync = true) {
    const clampedCount = Math.max(0, Math.min(BOT_LIMIT, nextBotCount));

    setBotCountState(clampedCount);
    setBotLastScores((currentScores) => currentScores.slice(0, clampedCount));
    setBotNames((currentNames) => pickBotNames(clampedCount, currentNames));
    setBotPersonalities((currentPersonalities) => pickBotPersonalities(clampedCount, currentPersonalities));
    setBotTotalScores((currentScores) => (
      Array.from({ length: clampedCount }, (_, index) => currentScores[index] ?? 0)
    ));
    if (shouldSync) {
      syncRoomSettings(getRoomSettings({ botCount: clampedCount }));
    }
  }

  function setBotDifficulty(nextBotDifficulty: BotDifficulty, shouldSync = true) {
    setBotDifficultyState(nextBotDifficulty);
    if (shouldSync) {
      syncRoomSettings(getRoomSettings({ botDifficulty: nextBotDifficulty }));
    }
  }

  function setTargetRounds(nextRoundCount: number, shouldSync = true) {
    const clampedRounds = Math.max(ROUND_LIMIT.min, Math.min(ROUND_LIMIT.max, nextRoundCount));

    setTargetRoundsState(clampedRounds);
    if (shouldSync) {
      syncRoomSettings(getRoomSettings({ targetRounds: clampedRounds }));
    }
  }

  function setRoundSeconds(nextRoundSeconds: number, shouldSync = true) {
    const steppedSeconds = Math.round(nextRoundSeconds / TIMER_LIMIT.step) * TIMER_LIMIT.step;
    const clampedSeconds = Math.max(TIMER_LIMIT.min, Math.min(TIMER_LIMIT.max, steppedSeconds));

    setRoundSecondsState(clampedSeconds);
    if (shouldSync) {
      syncRoomSettings(getRoomSettings({ roundSeconds: clampedSeconds }));
    }
  }

  function setModeCategories(categories: readonly StarterCategory[], shouldSync = true) {
    const nextCategories = STARTER_CATEGORIES.filter((category) => categories.includes(category));
    const safeCategories = nextCategories.length ? nextCategories : [...STARTER_CATEGORIES];

    setSelectedCategories(safeCategories);
    if (shouldSync) {
      syncRoomSettings(getRoomSettings({ categories: safeCategories }));
    }
  }

  function getRoomSettings(overrides: Partial<OnlineRoomSettings> = {}): OnlineRoomSettings {
    return {
      activeModeLabel,
      activeModeRules,
      botCount,
      botDifficulty,
      categories: selectedCategories,
      matchDurationSeconds,
      roundSeconds,
      scoringOwner,
      scoringStyle,
      targetRounds,
      ...overrides,
    };
  }

  function getModeSetupRoomSettings(modeSetup: GameModeSetup): OnlineRoomSettings {
    return {
      activeModeLabel: modeSetup.label,
      activeModeRules: modeSetup.rulesSummary,
      botCount: modeSetup.botCount,
      botDifficulty: modeSetup.botDifficulty,
      categories: [...modeSetup.categories],
      matchDurationSeconds: modeSetup.matchDurationSeconds ?? null,
      roundSeconds: modeSetup.roundSeconds,
      scoringOwner: modeSetup.scoringOwner ?? 'Opponents',
      scoringStyle: modeSetup.scoringStyle,
      targetRounds: modeSetup.rounds,
    };
  }

  function applySyncedRoomSettings(settings: OnlineRoomSettings) {
    const wasMatchStarted = Boolean(matchStartedAtMs);

    setActiveModeLabel(settings.activeModeLabel);
    setActiveModeRules(settings.activeModeRules);
    setBotCount(settings.botCount, false);
    setBotDifficulty(settings.botDifficulty, false);
    setMatchDurationSeconds(settings.matchDurationSeconds ?? null);
    if (!wasMatchStarted) {
      setMatchTimeRemaining(settings.matchDurationSeconds ?? 0);
    }
    setModeCategories(settings.categories, false);
    setRoundSeconds(settings.roundSeconds, false);
    setScoringOwnerState(settings.scoringOwner);
    setScoringStyle(settings.scoringStyle);
    setTargetRounds(settings.targetRounds, false);
  }

  function beginEditBrawl() {
    if (!room || room.visibility === 'public' || room.setupLocked || currentRound ||
        (room.isOnline && (!room.isHost || room.status !== 'lobby'))) return;
    editSnapshotRef.current = getRoomSettings();
    setIsEditingBrawl(true);
    setRoomError('');
  }

  function cancelEditBrawl() {
    if (isSavingBrawl) return;
    if (editSnapshotRef.current) applySyncedRoomSettings(editSnapshotRef.current);
    editSnapshotRef.current = null;
    setIsEditingBrawl(false);
    setRoomError('');
  }

  async function saveEditBrawl() {
    if (!editSnapshotRef.current || !room || saveBrawlInFlight.current) return;
    if (!activeModeLabel.trim()) { setRoomError('Enter a Brawl name before saving.'); return; }
    saveBrawlInFlight.current = true;
    setIsSavingBrawl(true);
    const settings = getRoomSettings();
    if (settings.activeModeRules === editSnapshotRef.current.activeModeRules) {
      settings.activeModeRules = settings.targetRounds + ' rounds, ' + settings.categories.length + ' categories, ' + settings.roundSeconds + ' seconds, ' + settings.botCount + ' CPUs. ' + settings.scoringStyle + ' scoring.';
    }
    try {
      if (room.isOnline) {
        if (!canSyncRoomSettings() || !room.id || !room.playerId) throw new Error('Only the host can edit an unstarted Brawl.');
        await updateOnlineRoomSettings({ playerId: room.playerId, roomId: room.id, settings });
      }
      applySyncedRoomSettings(settings);
      setRoom((previous) => previous ? { ...previous, settings } : previous);
      editSnapshotRef.current = null;
      setIsEditingBrawl(false);
      setRoomError('');
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not save Brawl.');
    } finally { saveBrawlInFlight.current = false; setIsSavingBrawl(false); }
  }

  function canSyncRoomSettings() {
    return Boolean(room?.isOnline && room.id && room.playerId && room.isHost && room.status === 'lobby' && !room.setupLocked);
  }

  function syncRoomSettings(settings: OnlineRoomSettings) {
    if (editSnapshotRef.current) return;
    if (!canSyncRoomSettings() || !room?.id || !room.playerId) {
      return;
    }

    updateOnlineRoomSettings({
      playerId: room.playerId,
      roomId: room.id,
      settings,
    }).catch((error) => {
      setRoomError(error instanceof Error ? error.message : 'Could not sync session setup.');
    });
  }

  function applyModeSetup(modeSetup: GameModeSetup) {
    setActiveModeLabel(modeSetup.label);
    setActiveModeRules(modeSetup.rulesSummary);
    setBotCount(modeSetup.botCount, false);
    setBotDifficulty(modeSetup.botDifficulty, false);
    setMatchDurationSeconds(modeSetup.matchDurationSeconds ?? null);
    setMatchStartedAtMs(null);
    setMatchTimeRemaining(modeSetup.matchDurationSeconds ?? 0);
    setModeCategories(modeSetup.categories, false);
    setRoundSeconds(modeSetup.roundSeconds, false);
    setScoringOwnerState(modeSetup.scoringOwner ?? 'Opponents');
    setScoringStyle(modeSetup.scoringStyle);
    setTargetRounds(modeSetup.rounds, false);
  }

  function setModeScoringStyle(nextScoringStyle: ScoringStyle) {
    const nextLabel = 'Custom';
    const nextRules = nextScoringStyle === 'Strict'
      ? 'Custom rules: wrong-letter answers score zero.'
      : 'Custom rules: players score answers during Reveal.';

    setScoringStyle(nextScoringStyle);
    setActiveModeLabel(nextLabel);
    setActiveModeRules(nextRules);
    syncRoomSettings(getRoomSettings({
      activeModeLabel: nextLabel,
      activeModeRules: nextRules,
      scoringStyle: nextScoringStyle,
    }));
  }

  function setScoringOwner(nextScoringOwner: ScoringOwner) {
    const nextLabel = 'Custom';
    const nextRules = nextScoringOwner === 'Opponents'
      ? 'Custom rules: opponents score first; challenge if it looks wrong.'
      : 'Custom rules: you score first, then opponents can dispute.';

    setScoringOwnerState(nextScoringOwner);
    setActiveModeLabel(nextLabel);
    setActiveModeRules(nextRules);
    syncRoomSettings(getRoomSettings({
      activeModeLabel: nextLabel,
      activeModeRules: nextRules,
      scoringOwner: nextScoringOwner,
    }));
  }

  function setPlayerAvatarKey(nextAvatarKey: string) {
    setPlayerProfile((currentProfile) => ({
      ...currentProfile,
      avatarKey: nextAvatarKey,
    }));
  }

  function ensurePlayerName() {
    const cleanName = playerName.trim() || createAnonymousName();

    if (cleanName !== playerName) {
      setPlayerName(cleanName);
    }

    setHasStoredPlayerName(true);
    AsyncStorage.setItem(PLAYER_NAME_STORAGE_KEY, cleanName).catch(() => undefined);
    return cleanName;
  }

  function chooseAnonymousName() {
    const anonymousName = createAnonymousName();

    setPlayerName(anonymousName);
    setHasStoredPlayerName(true);
    AsyncStorage.setItem(PLAYER_NAME_STORAGE_KEY, anonymousName).catch(() => undefined);
    setScreen('home');
  }

  function finishNameSetup() {
    ensurePlayerName();
    setScreen('home');
  }

  function completeQuickRules() {
    if (skipRulesOnLaunch) {
      AsyncStorage.setItem(RULES_SEEN_STORAGE_KEY, 'true').catch(() => undefined);
    } else {
      AsyncStorage.removeItem(RULES_SEEN_STORAGE_KEY).catch(() => undefined);
    }

    setScreen(hasStoredPlayerName || playerName.trim() ? 'home' : 'nameSetup');
  }

  function showQuickRules() {
    setScreen('rules');
  }

  async function dismissExpiredRoom() {
    setRoomExpiredNotice(false);
    await leaveRoom();
  }

  async function startRound() {
    if (!room || isMatchComplete || editSnapshotRef.current) {
      return;
    }

    const nextAnswers = createEmptyAnswers();
    const cleanManualLetter = manualRoundLetter.toUpperCase();
    const nextLetter = LETTER_POOL.includes(cleanManualLetter)
      ? cleanManualLetter
      : pickNextLetterFromBag(letterBag);
    const nextMatchStartedAtMs = matchDurationSeconds && !matchStartedAtMs ? Date.now() : matchStartedAtMs;
    const context = room?.isOnline && room.id
      ? {
        generation: matchGenerationRef.current,
        roomId: room.id,
        roundId: currentRound?.id ?? null,
      }
      : null;

    invalidateTimeoutFinalization();
    setIsRoundBusy(true);
    setRoomError('');

    try {
      const onlineRound = room.isOnline && room.id && room.playerId
        ? await startOnlineRound({
          letter: nextLetter,
          playerId: room.playerId,
          roundSeconds,
          roomId: room.id,
        })
        : {
          id: `${Date.now()}-${nextLetter}`,
          letter: nextLetter,
          roundNumber: roundHistory.length + 1,
        };

      if (context && !isCurrentOnlineMatchContext(context)) {
        return;
      }

      setCurrentRound(onlineRound);
      setLetterBag((currentLetters) => removeLetterFromBag(currentLetters, onlineRound.letter));
      if (nextMatchStartedAtMs) {
        setMatchStartedAtMs(nextMatchStartedAtMs);
      }
      setRoundLetter(onlineRound.letter);
      setManualRoundLetter('');
      setTimeRemaining(getRemainingSeconds(onlineRound.endsAt, roundSeconds));
      setAnswers(nextAnswers);
      setVerdicts(createVerdictsFromAnswers(nextAnswers, onlineRound.letter, scoringStyle));
      setBotRoundAnswers([]);
      setOnlineRevealAnswers([]);
      setOnlineMatchStandings([]);
      setOnlinePlayerRoundHistory([]);
      setOnlineRoundScores([]);
      setOnlineRoundAgreement(EMPTY_ONLINE_ROUND_AGREEMENT);
      setRoundSubmitted(false);
      setScreen('round');
    } catch (error) {
      if (!context || isCurrentOnlineMatchContext(context)) {
        setRoomError(error instanceof Error ? error.message : 'Could not start round.');
      }
    } finally {
      setIsRoundBusy(false);
    }
  }

  function updateAnswer(category: StarterCategory, value: string) {
    setAnswers((currentAnswers) => ({
      ...currentAnswers,
      [category]: value,
    }));

    if (room?.isOnline && currentRound?.id && room.playerId && !roundSubmitted) {
      const draftKey = `${currentRound.id}:${room.playerId}:${category}`;
      const existingTimer = draftSaveTimersRef.current[draftKey];

      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      draftSaveTimersRef.current[draftKey] = setTimeout(() => {
        delete draftSaveTimersRef.current[draftKey];
        saveOnlineDraftAnswer({
          answer: value,
          category,
          playerId: room.playerId!,
          roundId: currentRound.id,
        }).catch(() => undefined);
      }, DRAFT_SAVE_DEBOUNCE_MS);
    }
  }

  function toggleSelectedCategory(category: StarterCategory) {
    setSelectedCategories((currentCategories) => {
      const nextCategories = currentCategories.includes(category)
        ? currentCategories.length > 1
          ? currentCategories.filter((currentCategory) => currentCategory !== category)
          : currentCategories
        : STARTER_CATEGORIES.filter((starterCategory) => (
          starterCategory === category || currentCategories.includes(starterCategory)
        ));

      syncRoomSettings(getRoomSettings({ categories: nextCategories }));
      return nextCategories;
    });
  }

  async function finalizeTimedOutRound() {
    if (!room?.isOnline || !room.id || !room.playerId || !currentRound?.id) {
      return;
    }

    const timeoutGeneration = matchGenerationRef.current;
    const timeoutKey = `${timeoutGeneration}:${room.id}:${currentRound.id}`;
    const existingFinalization = timeoutFinalizationRef.current;

    if (existingFinalization?.key === timeoutKey) {
      return existingFinalization.promise;
    }

    const timeoutContext: OnlineMatchContext = {
      generation: matchGenerationRef.current,
      roomId: room.id,
      roundId: currentRound.id,
    };
    const timeoutPlayerId = room.playerId;
    const timeoutRoomId = room.id;
    const timeoutRoundId = currentRound.id;
    const timeoutOwner = Symbol('timeout-finalization');
    timeoutFinalizationOwnerRef.current = timeoutOwner;

    const finalization = (async () => {
      setIsRoundBusy(true);
      setRoomError('');
      const mutationEpoch = beginOnlineRevealMutation();

      try {
        const result = await finalizeOnlineRoundTimeout({
          playerId: timeoutPlayerId,
          roomId: timeoutRoomId,
          roundId: timeoutRoundId,
        });
        if (
          timeoutFinalizationOwnerRef.current !== timeoutOwner
          || !isCurrentOnlineMatchContext(timeoutContext)
        ) {
          return;
        }
        emitQaTelemetry('client.timeout-finalized', {
          duplicate: result.duplicate,
          phase: result.phase,
          revision: result.revision,
          roomId: timeoutRoomId,
          roundId: timeoutRoundId,
        });

        const { request, snapshot } = await readOnlineRevealSnapshot(timeoutRoomId, timeoutRoundId, 'authoritative');
        if (
          timeoutFinalizationOwnerRef.current !== timeoutOwner
          ||
          !isCurrentOnlineMatchContext(timeoutContext)
          || !snapshot
          || !isCurrentOnlineRevealSnapshotRequest(request)
        ) {
          return;
        }
        setOnlineRevealAnswers(snapshot.answers);
        setOnlineAnswerVoteRefreshWarning(null);
        setOnlineRoundScores(snapshot.scores);
        setOnlineRoundAgreement(getOnlineRoundAgreement(snapshot));
        setRoundSubmitted(true);
        setScreen('reveal');
      } catch (error) {
        if (
          timeoutFinalizationOwnerRef.current === timeoutOwner
          && isCurrentOnlineMatchContext(timeoutContext)
        ) {
          setRoomError(error instanceof Error ? error.message : 'Could not finalise timed-out round.');
        }
        debugGameError('round-timeout-finalize-failed', error, { roundId: timeoutRoundId });
      } finally {
        finishOnlineRevealMutation(mutationEpoch);
        if (timeoutFinalizationOwnerRef.current === timeoutOwner) {
          timeoutFinalizationOwnerRef.current = null;
          setIsRoundBusy(false);
        }
      }
    })();

    timeoutFinalizationRef.current = { key: timeoutKey, promise: finalization };

    try {
      await finalization;
    } finally {
      if (timeoutFinalizationRef.current?.promise === finalization) {
        timeoutFinalizationRef.current = null;
      }
      if (timeoutFinalizationOwnerRef.current === timeoutOwner) {
        timeoutFinalizationOwnerRef.current = null;
      }
    }
  }

  async function submitAnswers() {
    if (roundSubmitted) {
      return;
    }

    const submissionKey = currentRound?.id ?? `${roundLetter}:${roundHistory.length}`;
    const existingSubmission = roundSubmissionRef.current;

    if (existingSubmission?.key === submissionKey) {
      return existingSubmission.promise;
    }

    if (isRoundBusy) {
      return;
    }

    const submissionContext = room?.isOnline && room.id && currentRound?.id
      ? {
        generation: matchGenerationRef.current,
        roomId: room.id,
        roundId: currentRound.id,
      }
      : null;
    const submissionPlayerId = submissionContext && room?.playerId ? room.playerId : null;
    const submissionOwner = Symbol('round-submission');
    roundSubmissionOwnerRef.current = submissionOwner;
    const isCurrentSubmissionContext = () => (
      !submissionContext
      || (
        isCurrentOnlineMatchContext(submissionContext)
        && roundSubmissionRef.current?.key === submissionKey
      )
    );

    const submission = (async () => {
      setIsRoundBusy(true);
      setRoomError('');
      debugGameEvent('round-submit-start', {
        roundId: currentRound?.id,
        timedOut: timeRemaining === 0,
      });

      try {
        const nextVerdicts = scoringOwner === 'Opponents'
          ? createOpponentVerdictsFromAnswers(answers, roundLetter, scoringStyle, botPersonalities, botDifficulty)
          : createVerdictsFromAnswers(answers, roundLetter, scoringStyle);

        if (submissionContext && submissionPlayerId) {
          const selectedAnswers = Object.fromEntries(
            selectedCategories.map((category) => [category, answers[category]]),
          ) as Partial<AnswersByCategory>;

          await submitOnlineAnswers({
            answers: selectedAnswers,
            playerId: submissionPlayerId,
            roomId: submissionContext.roomId,
            roundId: submissionContext.roundId,
          });

          if (!isCurrentSubmissionContext()) {
            return;
          }

        }

        const nextBotRoundAnswers = room?.visibility === 'public' ? [] : markDuplicateBotAnswers(
          createBotRoundAnswers(
            botCount,
            botNames,
            botPersonalities,
            selectedCategories,
            botDifficulty,
            roundLetter,
          ),
          answers,
          selectedCategories,
        );
        const scoredBotRoundAnswers = scoringOwner === 'Self' || room?.visibility === 'public'
          ? scoreBotOwnAnswers(nextBotRoundAnswers, roundLetter, scoringStyle)
          : nextBotRoundAnswers;

        setBotRoundAnswers(scoredBotRoundAnswers);
        setRoundSubmitted(true);
        setVerdicts(nextVerdicts);
        setScreen('reveal');
      } catch (error) {
        if (isCurrentSubmissionContext()) {
          setRoomError(error instanceof Error ? error.message : 'Could not submit answers.');
        }
        debugGameError('round-submit-failed', error, { roundId: currentRound?.id });
      } finally {
        if (roundSubmissionOwnerRef.current === submissionOwner) {
          setIsRoundBusy(false);
        }
      }
    })();

    roundSubmissionRef.current = { key: submissionKey, promise: submission };

    try {
      await submission;
    } finally {
      if (roundSubmissionRef.current?.promise === submission) {
        roundSubmissionRef.current = null;
      }
      if (roundSubmissionOwnerRef.current === submissionOwner) {
        roundSubmissionOwnerRef.current = null;
      }
    }
  }

  function isOnlinePhaseExpired(phase: 'dispute' | 'scoring') {
    if (!room?.isOnline) {
      return false;
    }

    const deadlineIso = getPhaseDeadline(phase, {
      disputeEndsAt: onlineRoundAgreement.disputeEndsAt,
      scoringEndsAt: onlineRoundAgreement.scoringEndsAt,
    });
    const remainingSeconds = getDeadlineRemainingSeconds(deadlineIso);

    return remainingSeconds !== null && remainingSeconds <= 0 && !onlineRoundAgreement.isRoundReady;
  }

  function updateVerdict(category: StarterCategory, verdict: AnswerVerdict) {
    if (isOnlinePhaseExpired('scoring')) {
      setRoomError('Scoring deadline expired. Syncing the server result.');
      void finalizeTimedOutRound();
      return;
    }

    setVerdicts((currentVerdicts) => ({
      ...currentVerdicts,
      [category]: verdict,
    }));

    if (room?.isOnline) return;
  }

  function rejectVote(message: string): VoteOutcome {
    const error = new VoteCommandError(message, 'eligibility', 'rejected');
    setRoomError(describeVoteFailure(error));
    return { accepted: false, error };
  }

  async function persistCategoryVote(_category: StarterCategory, _vote: OnlineVoteVerdict, _finalVerdict: OnlineVoteVerdict): Promise<VoteOutcome> {
    // A player's own ordinary answer is never an eligible score-vote target.
    // Existing server disputes use persistSyncedDisputeVote instead.
    return rejectVote('You cannot score your own online answer. Open a server challenge and vote on that dispute.');
  }

  async function persistSyncedAnswerVote(answer: OnlineRevealAnswer, vote: OnlineVoteVerdict, finalVerdict: OnlineVoteVerdict): Promise<VoteOutcome> {
    if (!room?.isOnline || !currentRound?.id || !room.playerId) {
      return rejectVote('No active online round for this vote.');
    }
    if (isOnlinePhaseExpired('scoring')) {
      void finalizeTimedOutRound();
      return rejectVote('Scoring deadline expired.');
    }
    setRoomError('');
    const mutationEpoch = beginOnlineRevealMutation();
    const roomId = room.id!;
    const roundId = currentRound.id!;
    const voterPlayerId = room.playerId!;
    const context: OnlineMatchContext = {
      generation: matchGenerationRef.current,
      roomId,
      roundId,
    };
    try {
      let receipt = await persistOnlineAnswerVoteById({
        answerId: answer.id, answerOwnerPlayerId: answer.playerId, finalVerdict,
        roundId, vote, voterPlayerId,
      });

      if (!receipt.accepted || !isCurrentOnlineMatchContext(context)) {
        return receipt;
      }

      try {
        const { request, snapshot } = await readOnlineRevealSnapshot(roomId, roundId, 'authoritative');
        if (!snapshot || !isCurrentOnlineRevealSnapshotRequest(request)) {
          return receipt;
        }

        let syncedMatchState: Awaited<ReturnType<typeof syncOnlineMatchState>> | null = null;
        try {
          syncedMatchState = await syncOnlineMatchState(false);
        } catch (cause) {
          const refreshWarning = voteFailure(cause, 'refresh');
          setOnlineAnswerVoteRefreshWarning(refreshWarning.message);
          receipt = { ...receipt, refreshWarning };
        }
        if (!isCurrentOnlineMatchContext(context) || !isCurrentOnlineRevealSnapshotRequest(request)) {
          return receipt;
        }

        if (syncedMatchState?.isCurrent) {
          setOnlineAnswerVoteRefreshWarning(null);
        }
        setOnlineRevealAnswers(snapshot.answers);
        setOnlineRoundScores(snapshot.scores);
        setOnlineRoundAgreement(getOnlineRoundAgreement(snapshot));
        if (syncedMatchState?.isCurrent) {
          applyOnlineMatchState(syncedMatchState.standings, syncedMatchState.history);
          lastOnlineMatchSyncAtRef.current = Date.now();
        }
      } catch (cause) {
        const refreshWarning = voteFailure(cause, 'refresh');
        setOnlineAnswerVoteRefreshWarning(refreshWarning.message);
        receipt = { ...receipt, refreshWarning };
      }
      return receipt;
    } catch (cause) {
      const error = voteFailure(cause, 'cast-vote', true);
      setRoomError(describeVoteFailure(error));
      return { accepted: false, error };
    } finally {
      finishOnlineRevealMutation(mutationEpoch);
    }
  }

  async function openSyncedAnswerDispute(answer: OnlineRevealAnswer) {
    if (!room?.isOnline || !room.id || !currentRound?.id || !room.playerId) {
      return;
    }
    if (isOnlinePhaseExpired('scoring')) {
      setRoomError('Challenge deadline expired. Syncing the server result.');
      void finalizeTimedOutRound();
      return;
    }

    const context: OnlineMatchContext = {
      generation: matchGenerationRef.current,
      roomId: room.id,
      roundId: currentRound.id,
    };
    const mutationEpoch = beginOnlineRevealMutation();
    try {
      await openOnlineAnswerDispute({
        answerId: answer.id,
        openedByPlayerId: room.playerId,
        roomId: room.id,
        roundId: currentRound.id,
      });

      const { request, snapshot } = await readOnlineRevealSnapshot(room.id, currentRound.id, 'authoritative');
      if (!snapshot || !isCurrentOnlineRevealSnapshotRequest(request)) {
        return;
      }
      setOnlineRevealAnswers(snapshot.answers);
      setOnlineAnswerVoteRefreshWarning(null);
      setOnlineRoundScores(snapshot.scores);
      setOnlineRoundAgreement(getOnlineRoundAgreement(snapshot));
    } catch (error) {
      if (isCurrentOnlineMatchContext(context)) {
        setRoomError(error instanceof Error ? error.message : 'Could not open dispute.');
      }
    } finally {
      finishOnlineRevealMutation(mutationEpoch);
    }
  }

  async function persistSyncedDisputeVote(disputeId: string, vote: OnlineVoteVerdict): Promise<VoteOutcome> {
    if (!room?.isOnline || !room.id || !currentRound?.id || !room.playerId || !disputeId) {
      return rejectVote('No active online dispute for this vote.');
    }
    if (isOnlinePhaseExpired('dispute')) {
      void finalizeTimedOutRound();
      return rejectVote('Dispute deadline expired.');
    }
    const context: OnlineMatchContext = {
      generation: matchGenerationRef.current,
      roomId: room.id,
      roundId: currentRound.id,
    };
    setRoomError('');
    try {
      const receipt = await disputeVoteFlight.current(`${room.id}:${currentRound.id}:${disputeId}:${room.playerId}`, vote, async () => {
        const mutationEpoch = beginOnlineRevealMutation();
        try {
          let accepted = await persistOnlineDisputeVote({
            disputeId, roundId: currentRound.id, roomId: room.id!, verdict: vote, voterPlayerId: room.playerId!,
          });
          // A subsequent read failure must not turn an accepted vote into a failed vote.
          try {
            const { request, snapshot } = await readOnlineRevealSnapshot(room.id!, currentRound.id, 'authoritative');
            if (!snapshot || !isCurrentOnlineRevealSnapshotRequest(request)) {
              return accepted;
            }

            let syncedMatchState: Awaited<ReturnType<typeof syncOnlineMatchState>> | null = null;
            try {
              syncedMatchState = await syncOnlineMatchState(false);
            } catch (cause) {
              accepted = { ...accepted, refreshWarning: voteFailure(cause, 'refresh') };
            }
            if (!isCurrentOnlineRevealSnapshotRequest(request)) {
              return accepted;
            }

            setOnlineRevealAnswers(snapshot.answers);
            setOnlineAnswerVoteRefreshWarning(null);
            setOnlineRoundScores(snapshot.scores);
            setOnlineRoundAgreement(getOnlineRoundAgreement(snapshot));
            if (syncedMatchState) {
              applyOnlineMatchState(syncedMatchState.standings, syncedMatchState.history);
              lastOnlineMatchSyncAtRef.current = Date.now();
            }
          } catch (cause) {
            accepted = { ...accepted, refreshWarning: voteFailure(cause, 'refresh') };
          }
          return accepted;
        } finally {
          finishOnlineRevealMutation(mutationEpoch);
        }
      });
      const warnings = [receipt.warning, receipt.refreshWarning].filter((warning) => warning !== undefined);
      if (warnings.length && isCurrentOnlineMatchContext(context)) {
        setRoomError(`Vote accepted. ${warnings.map((warning) => `${warning.stage === 'refresh' ? 'Results refresh failed' : 'Challenge resolution failed'}: ${warning.message}`).join(' ')} Do not resubmit the vote.`);
      }
      return receipt;
    } catch (cause) {
      const error = voteFailure(cause, 'cast-dispute-vote', true);
      if (isCurrentOnlineMatchContext(context)) {
        setRoomError(describeVoteFailure(error));
      }
      return { accepted: false, error };
    }
  }

  async function submitBetaReport(report: Omit<OnlineReportInput, 'roomId' | 'reporterPlayerId'>) {
    if (!room?.isOnline || !room.id) {
      setRoomError('Reports are available in online sessions.');
      return;
    }

    setRoomError('');

    try {
      await submitOnlineReport({
        ...report,
        reporterPlayerId: room.playerId,
        roomId: room.id,
      });
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not send report.');
      throw error;
    }
  }

  function updateBotAnswerVerdict(botId: string, category: StarterCategory, verdict: AnswerVerdict) {
    setBotRoundAnswers((currentAnswers) => (
      currentAnswers.map((answer) => (
        answer.botId === botId && answer.category === category
          ? { ...answer, points: scoreAnswer({ verdict }), verdict }
          : answer
      ))
    ));
  }

  function applyOnlineBotSnapshot(snapshot: OnlineBotRoundSnapshot) {
    setBotNames(snapshot.bots.map((bot) => bot.playerName));
    setBotPersonalities(snapshot.bots.map((bot) => bot.personality as BotPersonality));
    setBotLastScores(snapshot.bots.map((bot) => bot.score));
    setBotTotalScores(snapshot.bots.map((bot) => bot.totalScore));
    const nextAnswers = snapshot.bots.flatMap((bot) => bot.answers.map((answer) => ({
      ...answer, botId: bot.playerId, botName: bot.playerName,
    })));
    setBotRoundAnswers(nextAnswers);
    return nextAnswers;
  }

  async function finishRound() {
    const currentRoundNumber = currentRound?.roundNumber ?? roundHistory.length + 1;
    const willCompleteMatch = matchDurationSeconds
      ? matchTimeRemaining <= 0
      : currentRoundNumber >= targetRounds;
    let serverBotSnapshot: OnlineBotRoundSnapshot | null = null;
    let syncedOnlineStandings: OnlineMatchStanding[] = [];
    let syncedOnlinePlayerStanding: OnlineMatchStanding | undefined;

    invalidateTimeoutFinalization();

    if (room?.isOnline && currentRound?.id && room.id && room.playerId) {
      const context: OnlineMatchContext = {
        generation: matchGenerationRef.current,
        roomId: room.id,
        roundId: currentRound.id,
      };
      setIsRoundBusy(true);
      setRoomError('');

      try {
        // Public CPU totals already include this round. Always use the server
        // snapshot at completion, even when reveal polling cached its answers.
        if (room.visibility === 'public') {
          serverBotSnapshot = await getOnlineBotRoundSnapshot(room.id, currentRound.id);
          if (!isCurrentOnlineMatchContext(context)) {
            setIsRoundBusy(false);
            return;
          }
          applyOnlineBotSnapshot(serverBotSnapshot);
        }
        await completeOnlineRound({
          finishMatch: willCompleteMatch,
          playerId: room.playerId,
          roomId: room.id,
          roundId: currentRound.id,
        });
        if (!isCurrentOnlineMatchContext(context)) {
          setIsRoundBusy(false);
          return;
        }
        const syncedMatchState = await syncOnlineMatchState();
        if (!syncedMatchState.isCurrent || !isCurrentOnlineMatchContext(context)) {
          setIsRoundBusy(false);
          return;
        }
        syncedOnlineStandings = syncedMatchState.standings;
        syncedOnlinePlayerStanding = syncedMatchState.standings.find((standing) => (
          standing.playerId === room.playerId
        ));
      } catch (error) {
        if (isCurrentOnlineMatchContext(context)) {
          setRoomError(error instanceof Error ? error.message : 'Could not finish round.');
        }
        setIsRoundBusy(false);
        return;
      }

      setIsRoundBusy(false);
    }

    const nextBotAnswers = serverBotSnapshot ? serverBotSnapshot.bots.flatMap((bot) => bot.answers.map((answer) => ({ ...answer, botId: bot.playerId, botName: bot.playerName }))) : botRoundAnswers.length
      ? botRoundAnswers
      : (() => {
        const generatedBotAnswers = markDuplicateBotAnswers(
          createBotRoundAnswers(botCount, botNames, botPersonalities, selectedCategories, botDifficulty, roundLetter),
          answers,
          selectedCategories,
        );

        return scoringOwner === 'Self' || room?.visibility === 'public'
          ? scoreBotOwnAnswers(generatedBotAnswers, roundLetter, scoringStyle)
          : generatedBotAnswers;
      })();
    const finalizedBotAnswers = room?.visibility === 'public' ? nextBotAnswers : scoreBotOwnAnswers(nextBotAnswers, roundLetter, scoringStyle);
    const nextBotScores = serverBotSnapshot ? serverBotSnapshot.bots.map((bot) => bot.score) : scoreBotRoundAnswers(botCount, finalizedBotAnswers);

    setBotRoundAnswers(finalizedBotAnswers);
    setBotLastScores(nextBotScores);
    const nextBotTotalScores = serverBotSnapshot ? serverBotSnapshot.bots.map((bot) => bot.totalScore) : Array.from(
      { length: botCount },
      (_, index) => (botTotalScores[index] ?? 0) + nextBotScores[index],
    );
    const nextPlayerScore = lifetimeScore + totalScore;
    const playerMatchScore = syncedOnlinePlayerStanding?.totalScore ?? nextPlayerScore;
    const playerRoundScore = syncedOnlinePlayerStanding?.lastRoundScore ?? totalScore;
    const nextStreak = playerRoundScore > 0 ? playerProfile.currentStreak + 1 : 0;
    const shouldRecordCompletedMatch = willCompleteMatch && !completedMatchRecordedRef.current;
    if (shouldRecordCompletedMatch) {
      completedMatchRecordedRef.current = true;
    }
    const nextBotStandingEntries = Array.from({ length: botCount }, (_, index) => ({
      id: `bot-${index + 1}`,
      score: nextBotTotalScores[index] ?? 0,
    }));
    const nextStandings = room?.isOnline && syncedOnlineStandings.length
      ? [
        ...syncedOnlineStandings.map((standing) => ({
        id: standing.playerId,
        score: standing.totalScore,
        })),
        ...nextBotStandingEntries,
      ].sort((a, b) => b.score - a.score)
      : [
        { id: 'player', score: nextPlayerScore },
        ...nextBotStandingEntries,
    ].sort((a, b) => b.score - a.score);
    const currentPlayerId = room?.isOnline ? room.playerId : 'player';
    const playerRank = Math.max(1, nextStandings.findIndex((entry) => entry.id === currentPlayerId) + 1);
    const nextMatchRecord: MatchRecord = {
      id: `${Date.now()}-${currentRound?.id ?? roundLetter}`,
      modeLabel: activeModeLabel,
      playedAt: new Date().toISOString(),
      playerRank,
      playerScore: playerMatchScore,
      pointsEarned: playerRoundScore,
      roundsPlayed: Math.max(roundHistory.length + 1, currentRound?.roundNumber ?? 1),
      totalPlayers: nextStandings.length,
      outcome: playerRank === 1 ? 'win' : 'loss',
    };
    const nextPlayerProfile = willCompleteMatch && !shouldRecordCompletedMatch
      ? playerProfile
      : {
        allTimePoints: playerProfile.allTimePoints + playerRoundScore,
        avatarKey: playerProfile.avatarKey,
        bestStreak: Math.max(playerProfile.bestStreak, nextStreak),
        currentStreak: nextStreak,
        gamesPlayed: playerProfile.gamesPlayed + (shouldRecordCompletedMatch ? 1 : 0),
        recentMatches: willCompleteMatch
          ? [nextMatchRecord, ...playerProfile.recentMatches].slice(0, 5)
          : playerProfile.recentMatches,
      };

    setLocalMatchStandings(nextStandings);
    if (!willCompleteMatch || shouldRecordCompletedMatch) {
      setLastMatchResult({
        achievementUnlockedLabels: getNewAchievementLabels(playerProfile, nextPlayerProfile),
        isWinner: playerRank === 1,
        playerRank,
        playerScore: playerMatchScore,
        pointsEarned: playerRoundScore,
        totalPlayers: nextStandings.length,
      });
    }
    setBotTotalScores(nextBotTotalScores);
    if (!room?.isOnline) {
      setRoundHistory((currentHistory) => [
        ...currentHistory,
        {
          id: `${Date.now()}-${roundLetter}`,
          roundNumber: currentRound?.roundNumber ?? currentHistory.length + 1,
          letter: roundLetter,
          answeredCount,
          categoryCount: selectedCategories.length,
          score: totalScore,
        },
      ]);
    }
    setPlayerProfile(nextPlayerProfile);
    setScreen('leaderboard');
  }

  return {
    beginEditBrawl, cancelEditBrawl, saveEditBrawl, isEditingBrawl, isSavingBrawl,
    setBrawlLabel: (label: string) => { if (editSnapshotRef.current && !saveBrawlInFlight.current) setActiveModeLabel(label.slice(0, 80)); },
    setBrawlRules: (rules: string) => { if (editSnapshotRef.current && !saveBrawlInFlight.current) setActiveModeRules(rules.slice(0, 500)); },
    retryLiveMatch: () => { setRoomError(''); setLiveTableAutoStartKey(''); setLiveTableCountdownRemaining(0); },
    answers,
    activeModeLabel,
    activeModeRules,
    applyModeSetup,
    answeredCount,
    botCount,
    botDifficulty,
    botPlayers,
    botRoundAnswers,
    chooseAnonymousName,
    cleanedRoomCode,
    createRoom,
    currentRound,
    completeQuickRules,
    finishRound,
    joinRoom,
    joinLiveTable,
    lastMatchResult,
    matchResetToken,
    leaveRoom,
    lifetimeScore,
    liveTableCountdownRemaining,
    onlineRevealAnswers,
    onlineAnswerVoteRefreshWarning,
    onlineMatchStandings,
    onlinePlayerRoundHistory,
    onlineRoundAgreement,
    onlineRoundScores,
    finishNameSetup,
    getOnlineLifecycleContext,
    isRoomBusy,
    isRoundBusy,
    localMatchStandings,
    isMatchComplete,
    playerName,
    playerProfile,
    manualRoundLetter,
    setPlayerAvatarKey,
    matchDurationSeconds,
    matchTimeRemaining,
    room,
    roomError,
    setRoomError,
    roomExpiredNotice,
    roomRejoinedNotice,
    roomCodeInput,
    roundHistory,
    roundLetter,
    roundSeconds,
    roundSubmitted,
    screen,
    scoringOwner,
    scoringStyle,
    selectedCategories,
    setBotCount,
    setBotDifficulty,
    setModeScoringStyle,
    setManualRoundLetter,
    setPlayerName,
    setRoomCodeInput,
    setRoundSeconds,
    setScoringOwner,
    setScreen,
    setTargetRounds,
    resetMatch,
    showQuickRules,
    skipRulesOnLaunch,
    setSkipRulesOnLaunch,
    dismissExpiredRoom,
    dismissRejoinedRoomNotice: () => setRoomRejoinedNotice(false),
    startPractice,
    startRound,
    submitAnswers,
    submitBetaReport,
    targetRounds,
    timeRemaining,
    totalScore,
    toggleSelectedCategory,
    updateAnswer,
    updateBotAnswerVerdict,
    updateVerdict,
    persistCategoryVote,
    openSyncedAnswerDispute,
    persistSyncedDisputeVote,
    persistSyncedAnswerVote,
    verdicts,
  };
}
