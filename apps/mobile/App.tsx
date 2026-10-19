import { createScoringNavigation, getHumanScoringWork, getScoringReadiness, scoringPhasePresentation } from './src/scoringReadiness';
import { describeVoteFailure, withVoteAcknowledgement } from './src/voteCommands';
import { getAnswerOutcome, normalizeAnswer, scoreAnswer, type AnswerVerdict } from '@animal-name-place/game-core';
import {
  APP_NAME,
  DEFAULT_ROUND_SECONDS,
  STARTER_CATEGORIES,
  type StarterCategory,
} from '@animal-name-place/shared';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  Bot,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Crown,
  Eye,
  Flame,
  Gamepad2,
  Hash,
  KeyRound,
  LogIn,
  LogOut,
  Medal,
  Minus,
  Music,
  Palette,
  Plus,
  Settings,
  Share2,
  ShieldQuestion,
  SlidersHorizontal,
  Sparkles,
  Star,
  Target,
  Timer,
  Trophy,
  Users,
  Volume2,
  X,
  Zap,
} from 'lucide-react-native';
import { type ComponentProps, type ComponentType, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  ActivityIndicator,
  AppState,
  Image as NativeImage,
  Modal,
  Platform,
  Pressable,
  Share,
  ScrollView,
  StyleSheet,
  StatusBar as NativeStatusBar,
  Text,
  TextInput,
  Vibration,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  buildReviewCategoryDeck,
  buildScoreComparisonEntries,
  resolveReviewSelection,
  reviewResolution,
  reviewDetailsVisible,
  type ReviewSelection,
} from './src/reviewPresentation';
import { countAnsweredBotAnswers } from './src/statisticsPresentation';
import { useGameAudio } from './src/useGameAudio';
import { debugGameError, installWebDiagnostics } from './src/devDiagnostics';
import { getKnownCategoriesForAnswer, type BotPersonality, type GameModeSetup, useLocalGame } from './src/useLocalGame';
import { findMatchingBotAnswer } from './src/localBotRound';
import { markOnlineRoomPlayerDisconnected, recoverOnlineRoomPlayer } from './src/onlineRooms';
import { createForegroundRecoveryCoordinator } from './src/foregroundRecovery';
import { getCountdownState, getPhaseDeadline, getTimeoutPhase } from './src/timeoutRules';
import {
  AnswerDetails,
  CategoryReviewCard,
  ReviewSummary,
  RoundTotal,
  type ReviewAnswer,
  type ReviewCategory,
} from './src/components/ReviewComponents';
import {
  type CachedWordBank,
  checkServerWordValidation,
  getCachedWordSuggestions,
  isCachedWordAccepted,
  loadCachedWordBank,
  rememberAcceptedWord,
  shouldSyncWordBankCache,
  syncWordBankCache,
} from './src/wordBank';
import { BUILD_METADATA } from './src/generated/buildMetadata';

const INK = '#1F2430';
const SHOW_DECORATIVE_ART = false;
const WORD_BRAWL_LOGO = undefined;

type DeferredImageProps = Omit<ComponentProps<typeof NativeImage>, 'style'> & { style?: any };

function DeferredImage(props: DeferredImageProps) {
  return SHOW_DECORATIVE_ART ? <NativeImage {...props} /> : null;
}

const WORD_BRAWL_ART = {
  heroPoster: undefined,
  liveModes: undefined,
  mascotJump: undefined,
  mascotReady: undefined,
  roomPreview: undefined,
  wordBadge: undefined,
};
const THEMES = {
  arcade: {
    accent: '#F7C531',
    background: '#F8EBCB',
    label: 'Brawl',
    lanes: ['#FFE66D', '#FFFFFF', '#B8F7D4', '#FF9A8A'],
  },
  carnival: {
    accent: '#FF7A1A',
    background: '#FFE66D',
    label: 'Carnival',
    lanes: ['#FF9A8A', '#FFE66D', '#B8F7D4', '#FFFFFF'],
  },
  night: {
    accent: '#B8F7D4',
    background: '#293462',
    label: 'Night',
    lanes: ['#B8F7D4', '#7BDFF2', '#FFE66D', '#FF9A8A'],
  },
} as const;
const SOUND_PACKS = ['Word', 'Arcade', 'Pop'];
const BOT_LIBRARY_LABEL = 'CPU word bank: 7 categories, 546 starter answers.';
const LETTER_OPTIONS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const SCORING_HELP_STORAGE_KEY = 'animal-name-place/scoring-help-seen/v1';
const HAPTICS_STORAGE_KEY = 'animal-name-place/haptics-enabled/v1';
const LIVE_BRAWL_TARGET_PLAYERS = 5;
const LIVE_BRAWL_BOT_FILL_SECONDS = 0.65;

function shouldRenderLegacyScoringStep(step: string): boolean {
  return step !== 'review';
}

const LOBBY_BOT_FILL_PERSONALITIES: BotPersonality[] = [
  'Speedy',
  'Skeptical',
  'Chaotic',
  'Careful',
  'Aggressive',
  'Scholar',
  'Sloppy',
  'Generous',
];
const VERDICT_LABELS = {
  blank: 'Pending',
  duplicate: 'Shared',
  disputed: 'Needs review',
  invalid: 'No score',
  valid: 'Unique',
  variant: 'Shared',
} as const;
type ModeIcon = ComponentType<{ color: string; size: number; strokeWidth: number }>;
const PLAYER_AVATARS: Array<{
  accent: string;
  icon: ModeIcon;
  key: string;
  label: string;
}> = [
  { accent: '#FF4F5E', icon: Sparkles, key: 'spark', label: 'Spark' },
  { accent: '#FFE66D', icon: Star, key: 'star', label: 'Star' },
  { accent: '#FF9A1F', icon: Flame, key: 'flame', label: 'Flame' },
  { accent: '#B8F7D4', icon: Zap, key: 'zap', label: 'Zap' },
  { accent: '#7BDFF2', icon: Target, key: 'target', label: 'Target' },
  { accent: '#D7B8FF', icon: Crown, key: 'crown', label: 'Crown' },
];
const GAME_MODES: Array<GameModeSetup & {
  accent: string;
  description: string;
  howToPlay: string;
  icon: ModeIcon;
}> = [
  {
    accent: '#214E9C',
    categories: STARTER_CATEGORIES,
    description: 'The standard game',
    howToPlay: 'Three rounds on the full board. Simple scoring, no forced CPUs.',
    icon: Gamepad2,
    label: 'Classic',
    roundSeconds: DEFAULT_ROUND_SECONDS,
    rounds: 3,
    botCount: 0,
    botDifficulty: 'Normal',
    rulesSummary: '3 rounds. Full board. Classic scoring.',
    scoringOwner: 'Opponents',
    scoringStyle: 'Classic',
  },
  {
    accent: '#FF4F5E',
    categories: ['Name', 'Place', 'Animal', 'Food', 'Object'] satisfies StarterCategory[],
    description: 'Train against CPUs',
    howToPlay: 'Race two CPUs through a tight board with strict scoring.',
    icon: Bot,
    label: 'Practice',
    roundSeconds: 60,
    rounds: 5,
    botCount: 2,
    botDifficulty: 'Hard',
    rulesSummary: 'Five rounds, five categories, two hard CPUs.',
    scoringOwner: 'Opponents',
    scoringStyle: 'Strict',
  },
  {
    accent: '#FF9A1F',
    categories: STARTER_CATEGORIES,
    description: '5 min, no round cap',
    howToPlay: 'The match clock starts on your first round. Keep starting rounds and stack points until time runs out.',
    icon: Flame,
    label: 'Marathon',
    matchDurationSeconds: 300,
    roundSeconds: 45,
    rounds: 999,
    botCount: 2,
    botDifficulty: 'Hard',
    rulesSummary: 'Five-minute score chase, no round cap, two hard CPUs.',
    scoringOwner: 'Opponents',
    scoringStyle: 'Strict',
  },
  {
    accent: '#1F2430',
    categories: STARTER_CATEGORIES,
    description: 'Set your own rules',
    howToPlay: 'Choose CPUs, difficulty, timer, scoring style, categories, and match length in the lobby.',
    icon: SlidersHorizontal,
    label: 'Custom',
    roundSeconds: DEFAULT_ROUND_SECONDS,
    rounds: 3,
    botCount: 0,
    botDifficulty: 'Normal',
    rulesSummary: 'Set categories, CPUs, rounds, timer, and scoring before play.',
    scoringOwner: 'Opponents',
    scoringStyle: 'Classic',
  },
];
const LEAGUES = [
  { color: '#B8F7D4', minScore: 0, name: 'Rookie', next: 150 },
  { color: '#CD7F32', minScore: 150, name: 'Bronze', next: 350 },
  { color: '#AEB7C2', minScore: 350, name: 'Silver', next: 700 },
  { color: '#F2C94C', minScore: 700, name: 'Gold', next: 1200 },
  { color: '#D7B8FF', minScore: 1200, name: 'Platinum', next: 1800 },
  { color: '#7BDFF2', minScore: 1800, name: 'Diamond', next: 2600 },
  { color: '#FF9A1F', minScore: 2600, name: 'Master', next: 4000 },
  { color: '#FF4F5E', minScore: 4000, name: 'Legend', next: null },
] as const;
const SEEDED_GLOBAL_PLAYERS = [
  { id: 'zara', meta: 'Master League', name: 'Zara', score: 2860 },
  { id: 'kofi', meta: 'Diamond League', name: 'Kofi', score: 2140 },
  { id: 'lana', meta: 'Platinum League', name: 'Lana', score: 1440 },
  { id: 'sparkly', meta: 'Gold League', name: 'Sparkly', score: 980 },
  { id: 'ade', meta: 'Silver League', name: 'Ade', score: 760 },
  { id: 'mira', meta: 'Silver League', name: 'Mira', score: 420 },
  { id: 'tunde', meta: 'Bronze League', name: 'Tunde', score: 210 },
];

function MessageIcon({ color, size, strokeWidth }: { color: string; size: number; strokeWidth: number }) {
  return <Sparkles color={color} size={size} strokeWidth={strokeWidth} />;
}

function BrandIconMark({ color = '#FFFFFF', size = 42 }: { color?: string; size?: number }) {
  return (
    <Svg fill="none" height={size} viewBox="0 0 64 64" width={size}>
      <Path
        d="M12 41C16 19 38 7 51 22C62 35 44 56 22 48C13 45 9 38 12 29"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={5}
      />
      <Path
        d="M18 36C27 21 43 20 49 32"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={5}
      />
      <Path
        d="M20 47C31 40 40 29 45 17"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={5}
      />
      <Circle cx={18} cy={28} fill={color} r={3.5} />
      <Circle cx={47} cy={36} fill={color} r={3.5} />
    </Svg>
  );
}

function formatClock(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatNameList(names: readonly string[]) {
  if (!names.length) {
    return '';
  }

  if (names.length === 1) {
    return names[0];
  }

  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function formatRoomAvailability(expiresAt?: string, nowMs = Date.now()) {
  if (!expiresAt) {
    return '15 min';
  }

  const remainingSeconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - nowMs) / 1000));

  if (remainingSeconds <= 0) {
    return 'expired';
  }

  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  if (minutes <= 0) {
    return `${seconds}s`;
  }

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function formatOrdinal(value: number) {
  const suffix = value % 10 === 1 && value % 100 !== 11
    ? 'st'
    : value % 10 === 2 && value % 100 !== 12
      ? 'nd'
      : value % 10 === 3 && value % 100 !== 13
        ? 'rd'
        : 'th';

  return `${value}${suffix}`;
}

function formatShortDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Recent';
  }

  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function getLeague(score: number) {
  return [...LEAGUES].reverse().find((league) => score >= league.minScore) ?? LEAGUES[0];
}

function getScoreToneStyle(verdict: AnswerVerdict) {
  if (verdict === 'disputed') {
    return styles.scoreToneHalf;
  }

  const outcome = getAnswerOutcome(verdict);

  if (outcome === 'unique') {
    return styles.scoreToneValid;
  }

  if (outcome === 'shared') {
    return styles.scoreToneHalf;
  }

  if (outcome === 'no_score') {
    return styles.scoreToneInvalid;
  }

  return styles.scoreToneBlank;
}

function getScoreActionToneStyle(verdict: DisputeVote) {
  if (verdict === 'valid') {
    return styles.scoreActionValid;
  }

  if (verdict === 'variant') {
    return styles.scoreActionHalf;
  }

  return styles.scoreActionInvalid;
}

function getScoreActionSelectedToneStyle(verdict: DisputeVote) {
  if (verdict === 'valid') {
    return styles.scoreActionValidSelected;
  }

  if (verdict === 'variant') {
    return styles.scoreActionHalfSelected;
  }

  return styles.scoreActionInvalidSelected;
}

function getScoreBadgeLabel(answer: string, verdict: AnswerVerdict, points: number) {
  if (!answer.trim()) {
    return '0 pts';
  }

  if (verdict === 'blank') {
    return '--';
  }

  if (verdict === 'disputed') {
    return 'Review';
  }

  return `${points} pts`;
}

function stableHash(value: string) {
  return value.split('').reduce((hash, character) => (
    ((hash * 31) + character.charCodeAt(0)) >>> 0
  ), 0);
}

type ThemeKey = keyof typeof THEMES;
type DisputeVote = Extract<AnswerVerdict, 'invalid' | 'valid' | 'variant'>;
type BotTableVote = {
  botId: string;
  botName: string;
  vote: DisputeVote;
};
type DisputeNotice = {
  category: StarterCategory;
  challengerName: string;
  reason: string;
  suggestedVote: DisputeVote;
};
type LetterPickerMode = 'random' | 'pick';
type ScoringStep = 'score' | 'review';
type ReportTarget = {
  answerId?: string;
  details?: string;
  playerName?: string;
  reason: string;
  reportedPlayerId?: string;
  title: string;
};
type ChallengeResultNotice = {
  disputeId?: string;
  message: string;
  title: string;
};
type FactCheckTarget = {
  answer: string;
  category: StarterCategory;
  playerName?: string;
};
type FactCheckResult = {
  categoryNote: string;
  definitions: string[];
  error?: string;
  verdict: 'verified' | 'possible' | 'invalid' | 'loading';
  source: string;
  status: 'found' | 'loading' | 'not_found' | 'error';
  suggestions: string[];
  word: string;
};
type ScoreReasonTarget = {
  answer: string;
  category: StarterCategory;
  key: string;
  playerName: string;
  verdict: DisputeVote;
};
const SCORE_REASON_OPTIONS: Record<Extract<DisputeVote, 'invalid' | 'variant'>, string[]> = {
  invalid: [
    'Wrong letter',
    'Wrong category',
    'Not a real word',
    'Too unclear',
  ],
  variant: [
    'Close spelling',
    'Partial fit',
    'Duplicate idea',
    'Needs checking',
  ],
};

export default function App() {
  const [themeKey, setThemeKey] = useState<ThemeKey>('arcade');
  const [musicOn, setMusicOn] = useState(true);
  const [soundFxOn, setSoundFxOn] = useState(true);
  const [hapticsOn, setHapticsOn] = useState(true);
  const { width: viewportWidth } = useWindowDimensions();
  const [soundPack, setSoundPack] = useState(SOUND_PACKS[0]);
  const [selectedMode, setSelectedMode] = useState<(typeof GAME_MODES)[number] | null>(null);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [showAdvancedModes, setShowAdvancedModes] = useState(false);
  const [showLobbySettings, setShowLobbySettings] = useState(false);
  const [practiceHelpExpanded, setPracticeHelpExpanded] = useState(false);
  const [showScoringHelp, setShowScoringHelp] = useState(false);
  const [doNotShowScoringHelpAgain, setDoNotShowScoringHelpAgain] = useState(false);
  const [hideScoringHelpPermanently, setHideScoringHelpPermanently] = useState(false);
  const [showLeaveRoomConfirm, setShowLeaveRoomConfirm] = useState(false);
  const [leaveCooldownUntilMs, setLeaveCooldownUntilMs] = useState(0);
  const [leaveCooldownNowMs, setLeaveCooldownNowMs] = useState(Date.now());
  const [availabilityNowMs, setAvailabilityNowMs] = useState(Date.now());
  const [phaseCountdownNowMs, setPhaseCountdownNowMs] = useState(Date.now());
  const [disputedCategories, setDisputedCategories] = useState<StarterCategory[]>([]);
  const [botDisputedCategories, setBotDisputedCategories] = useState<StarterCategory[]>([]);
  const [disputedBotAnswers, setDisputedBotAnswers] = useState<string[]>([]);
  const [categoryVotes, setCategoryVotes] = useState<Partial<Record<StarterCategory, DisputeVote>>>({});
  const [categoryPlayerVotes, setCategoryPlayerVotes] = useState<Partial<Record<StarterCategory, DisputeVote>>>({});
  const [botCategoryVotes, setBotCategoryVotes] = useState<Partial<Record<StarterCategory, DisputeVote>>>({});
  const [categoryBotVoteLists, setCategoryBotVoteLists] = useState<Partial<Record<StarterCategory, BotTableVote[]>>>({});
  const [botAnswerVotes, setBotAnswerVotes] = useState<Record<string, DisputeVote>>({});
  const [botAnswerPlayerVotes, setBotAnswerPlayerVotes] = useState<Record<string, DisputeVote>>({});
  const [botAnswerBotVoteLists, setBotAnswerBotVoteLists] = useState<Record<string, BotTableVote[]>>({});
  const [botCounterVotes, setBotCounterVotes] = useState<Record<string, DisputeVote>>({});
  const [activeDisputeNotice, setActiveDisputeNotice] = useState<DisputeNotice | null>(null);
  const [activeReportTarget, setActiveReportTarget] = useState<ReportTarget | null>(null);
  const [activeFactCheckTarget, setActiveFactCheckTarget] = useState<FactCheckTarget | null>(null);
  const [activeScoreReasonTarget, setActiveScoreReasonTarget] = useState<ScoreReasonTarget | null>(null);
  const [challengeResultNotice, setChallengeResultNotice] = useState<ChallengeResultNotice | null>(null);
  const [scoreReasons, setScoreReasons] = useState<Record<string, string>>({});
  const [factCheckResult, setFactCheckResult] = useState<FactCheckResult | null>(null);
  const [dismissedMatchResultKey, setDismissedMatchResultKey] = useState('');
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [reportNotice, setReportNotice] = useState('');
  const [letterShufflePreview, setLetterShufflePreview] = useState('');
  const [letterPickerMode, setLetterPickerMode] = useState<LetterPickerMode>('random');
  const [showNextLetterModal, setShowNextLetterModal] = useState(false);
  const [scoringStep, setScoringStep] = useState<ScoringStep>('score');
  const [scoringCardIndex, setScoringCardIndex] = useState(0);
  const [reviewSelection, setReviewSelection] = useState<ReviewSelection | null>(null);
  const [collapsedReviewCategories, setCollapsedReviewCategories] = useState<string[]>([]);
  const [leftRoomNoticeNames, setLeftRoomNoticeNames] = useState<string[]>([]);
  const [roomActivityNotice, setRoomActivityNotice] = useState('');
  const [botCategoryDisputeReasons, setBotCategoryDisputeReasons] = useState<Partial<Record<StarterCategory, string>>>({});
  const [cachedWordBank, setCachedWordBank] = useState<CachedWordBank>({});
  const [cpuDisputeRoundKey, setCpuDisputeRoundKey] = useState('');
  const scrollViewRef = useRef<ScrollView>(null);
  const disputePanelOffsetsRef = useRef<Record<string, number>>({});
  const factCheckRequestRef = useRef(0);
  const timeoutHapticRoundRef = useRef('');
  const [highlightedDisputeId, setHighlightedDisputeId] = useState('');
  const previousRoomPlayersRef = useRef<{ code?: string; names: string[] }>({ names: [] });
  const scoreDeckScrollRef = useRef<ScrollView>(null);
  const activeTheme = THEMES[themeKey];
  const laneColor = (index: number) => activeTheme.lanes[index % activeTheme.lanes.length];
  const {
    answers,
    activeModeLabel,
    activeModeRules,
    beginEditBrawl, cancelEditBrawl, saveEditBrawl, isEditingBrawl, isSavingBrawl, retryLiveMatch, setBrawlLabel, setBrawlRules,
    applyModeSetup,
    answeredCount,
    botCount,
    botDifficulty,
    botPlayers,
    botRoundAnswers,
    chooseAnonymousName,
    cleanedRoomCode,
    completeQuickRules,
    createRoom,
    currentRound,
    dismissExpiredRoom,
    dismissRejoinedRoomNotice,
    finishNameSetup,
    finishRound,
    getOnlineLifecycleContext,
    isRoomBusy,
    isRoundBusy,
    isMatchComplete,
    joinRoom,
    joinLiveTable,
    lastMatchResult,
    matchResetToken,
    leaveRoom,
    lifetimeScore,
    liveTableCountdownRemaining,
    localMatchStandings,
    matchDurationSeconds,
    matchTimeRemaining,
    manualRoundLetter,
    onlineRevealAnswers,
    onlineAnswerVoteRefreshWarning,
    onlineMatchStandings,
    onlinePlayerRoundHistory,
    onlineRoundAgreement,
    onlineRoundScores,
    playerProfile,
    playerName,
    room,
    roomCodeInput,
    roomError,
    setRoomError,
    roomExpiredNotice,
    roomRejoinedNotice,
    roundHistory,
    roundLetter,
    roundSeconds,
    roundSubmitted,
    screen,
    selectedCategories,
    setBotCount,
    setBotDifficulty,
    setManualRoundLetter,
    setModeScoringStyle,
    setPlayerAvatarKey,
    setPlayerName,
    setRoomCodeInput,
    setRoundSeconds,
    setScoringOwner,
    setScreen,
    setTargetRounds,
    persistCategoryVote,
    openSyncedAnswerDispute,
    persistSyncedDisputeVote,
    persistSyncedAnswerVote,
    resetMatch,
    showQuickRules,
    skipRulesOnLaunch,
    setSkipRulesOnLaunch,
    scoringOwner,
    scoringStyle,
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
    verdicts,
  } = useLocalGame();
  useEffect(() => {
    const warningPrefix = 'Your vote was accepted. Results may be temporarily outdated.';
    if (onlineAnswerVoteRefreshWarning) {
      setChallengeResultNotice({
        title: 'Vote accepted',
        message: `${warningPrefix} Refresh failed: ${onlineAnswerVoteRefreshWarning} Do not resubmit the vote.`,
      });
      return;
    }

    setChallengeResultNotice((currentNotice) => (
      currentNotice?.message.startsWith(warningPrefix) ? null : currentNotice
    ));
  }, [onlineAnswerVoteRefreshWarning]);
  const leaveCooldownSeconds = Math.max(0, Math.ceil((leaveCooldownUntilMs - leaveCooldownNowMs) / 1000));
  const gameAudio = useGameAudio({ activeModeLabel, musicOn, soundFxOn, soundPack });
  const isTimerUrgent = screen === 'round' && !roundSubmitted && timeRemaining > 0 && timeRemaining <= 12;
  const isCompactWeb = Platform.OS === 'web' && viewportWidth < 760;
  const isDesktopWeb = Platform.OS === 'web' && viewportWidth >= 1100;
  const isNarrowScoring = viewportWidth < 700;
  const shouldRenderLegacyScoring = shouldRenderLegacyScoringStep(scoringStep);

  function triggerHaptic(kind: 'selection' | 'submit' | 'score' | 'dispute' | 'celebration' | 'success' | 'error' = 'selection') {
    if (!hapticsOn) {
      return;
    }

    try {
      const patterns = {
        celebration: [0, 24, 35, 40, 45, 70],
        dispute: [0, 22, 35, 48],
        error: [0, 35, 45, 35],
        score: [0, 24],
        selection: 12,
        submit: [0, 18],
        success: [0, 18, 35, 28],
      } satisfies Record<typeof kind, number | number[]>;
      const pattern = patterns[kind];

      if (Platform.OS === 'web') {
        const browserNavigator = globalThis.navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
        browserNavigator.vibrate?.(pattern);
        return;
      }

      Vibration.vibrate(pattern);
    } catch (error) {
      // Haptics are optional device feedback and must never block a game action.
      debugGameError('haptic-failed', error, { kind, platform: Platform.OS });
    }
  }

  useEffect(() => installWebDiagnostics(), []);
  useEffect(() => { setPracticeHelpExpanded(false); }, [selectedMode?.label, screen]);

  useEffect(() => {
    if (matchResetToken === 0) {
      return;
    }

    // These values belong to the completed match, not the player's settings.
    // Reset them with the hook's match boundary so a new game cannot inherit
    // an old review card, dispute, fact check, or scoring step.
    setDisputedCategories([]);
    setBotDisputedCategories([]);
    setDisputedBotAnswers([]);
    setCategoryVotes({});
    setCategoryPlayerVotes({});
    setBotCategoryVotes({});
    setCategoryBotVoteLists({});
    setBotAnswerVotes({});
    setBotAnswerPlayerVotes({});
    setBotAnswerBotVoteLists({});
    setBotCounterVotes({});
    setBotCategoryDisputeReasons({});
    setActiveDisputeNotice(null);
    setActiveReportTarget(null);
    setActiveFactCheckTarget(null);
    setActiveScoreReasonTarget(null);
    setScoreReasons({});
    setFactCheckResult(null);
    setDismissedMatchResultKey('');
    setIsSendingReport(false);
    setReportNotice('');
    setLetterShufflePreview('');
    setLetterPickerMode('random');
    setShowNextLetterModal(false);
    setScoringStep('score');
    setScoringCardIndex(0);
    setReviewSelection(null);
    setCollapsedReviewCategories([]);
    setHighlightedDisputeId('');
    setLeftRoomNoticeNames([]);
    setRoomActivityNotice('');
  }, [matchResetToken]);

  useEffect(() => {
    const roundKey = currentRound?.id ?? `${roundLetter}:${roundHistory.length}`;

    if (screen !== 'round' || roundSubmitted || timeRemaining !== 0 || timeoutHapticRoundRef.current === roundKey) {
      return;
    }

    timeoutHapticRoundRef.current = roundKey;
    triggerHaptic('error');
  }, [currentRound?.id, roundHistory.length, roundLetter, roundSubmitted, screen, timeRemaining]);

  useEffect(() => {
    AsyncStorage.getItem(SCORING_HELP_STORAGE_KEY)
      .then((hasSeenScoringHelp) => {
        const shouldHideScoringHelp = hasSeenScoringHelp === 'true';

        setHideScoringHelpPermanently(shouldHideScoringHelp);
        setShowScoringHelp(!shouldHideScoringHelp);
      })
      .catch(() => {
        setShowScoringHelp(true);
      });
  }, []);

  useEffect(() => {
    AsyncStorage.getItem(HAPTICS_STORAGE_KEY)
      .then((storedValue) => {
        if (storedValue !== null) {
          setHapticsOn(storedValue === 'true');
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(HAPTICS_STORAGE_KEY, String(hapticsOn)).catch(() => undefined);
  }, [hapticsOn]);

  useEffect(() => {
    if (!room?.isOnline || (screen !== 'reveal' && screen !== 'scoring')) {
      return undefined;
    }

    setPhaseCountdownNowMs(Date.now());
    const intervalId = setInterval(() => setPhaseCountdownNowMs(Date.now()), 1000);

    return () => clearInterval(intervalId);
  }, [room?.isOnline, screen]);

  useEffect(() => {
    if (!roomActivityNotice) {
      return;
    }

    const timeoutId = setTimeout(() => setRoomActivityNotice(''), 3600);
    return () => clearTimeout(timeoutId);
  }, [roomActivityNotice]);

  useEffect(() => {
    if (!room?.isOnline || !room.id || !room.playerId) {
      return;
    }

    const playerId = room.playerId;
    const displayName = room.playerName;
    const roomId = room.id;
    let isMounted = true;
    const initialContext = getOnlineLifecycleContext();
    const isCurrent = () => {
      const currentContext = getOnlineLifecycleContext();
      return isMounted
        && currentContext.generation === initialContext.generation
        && currentContext.roomId === roomId;
    };
    const recovery = createForegroundRecoveryCoordinator({
      isCurrent,
      onError: (error) => setRoomError(error instanceof Error ? error.message : 'Could not recover the session connection.'),
    });

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        recovery.schedule('active', async () => {
          const result = await recoverOnlineRoomPlayer({ roomId, playerId, displayName: displayName ?? '' });
          if (result.status === 'unavailable') return;
        });
      } else if (nextState === 'background' || nextState === 'inactive') {
        recovery.schedule('disconnected', () => markOnlineRoomPlayerDisconnected(playerId));
      }
    });

    return () => {
      isMounted = false;
      recovery.invalidate();
      subscription.remove();
    };
  }, [room?.id, room?.isOnline, room?.playerId, room?.playerName]);

  useEffect(() => {
    let isMounted = true;

    loadCachedWordBank()
      .then((bank) => {
        if (isMounted) {
          setCachedWordBank(bank);
        }
      })
      .catch(() => undefined);

    shouldSyncWordBankCache()
      .then(async (shouldSync) => {
        if (!shouldSync) {
          return;
        }

        const bank = await syncWordBankCache();

        if (isMounted) {
          setCachedWordBank(bank);
        }
      })
      .catch(() => undefined);

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!room?.expiresAt) {
      return;
    }

    setAvailabilityNowMs(Date.now());
    const availabilityTimerId = setInterval(() => {
      setAvailabilityNowMs(Date.now());
    }, 1000);

    return () => clearInterval(availabilityTimerId);
  }, [room?.expiresAt]);

  useEffect(() => {
    if (!leaveCooldownUntilMs) {
      return;
    }

    setLeaveCooldownNowMs(Date.now());
    const cooldownTimerId = setInterval(() => {
      setLeaveCooldownNowMs(Date.now());
    }, 250);

    return () => clearInterval(cooldownTimerId);
  }, [leaveCooldownUntilMs]);

  useEffect(() => {
    scrollViewRef.current?.scrollTo({ animated: false, y: 0 });
  }, [roundLetter, screen, scoringStep]);

  useEffect(() => {
    const currentCode = room?.code;
    const currentNames = room?.playerNames ?? [];
    const previous = previousRoomPlayersRef.current;

    if (!currentCode) {
      previousRoomPlayersRef.current = { names: [] };
      return;
    }

    if (previous.code === currentCode && previous.names.length > currentNames.length) {
      const leftNames = previous.names.filter((name) => !currentNames.includes(name));

      if (leftNames.length) {
        setLeftRoomNoticeNames(leftNames);
        setRoomActivityNotice(`${formatNameList(leftNames)} left the game`);
      }
    }

    if (previous.code === currentCode && currentNames.length > previous.names.length) {
      const joinedNames = currentNames.filter((name) => !previous.names.includes(name));

      if (joinedNames.length) {
        setRoomActivityNotice(`${formatNameList(joinedNames)} joined the game`);
      }
    }

    previousRoomPlayersRef.current = { code: currentCode, names: currentNames };
  }, [room?.code, room?.playerNames]);

  useEffect(() => {
    if (screen !== 'round' || !roundLetter) {
      setLetterShufflePreview('');
      return;
    }

    let shuffleStep = 0;
    setLetterShufflePreview(LETTER_OPTIONS[Math.floor(Math.random() * LETTER_OPTIONS.length)]);

    const shuffleTimerId = setInterval(() => {
      shuffleStep += 1;

      if (shuffleStep >= 8) {
        setLetterShufflePreview(roundLetter);
        clearInterval(shuffleTimerId);
        return;
      }

      setLetterShufflePreview(LETTER_OPTIONS[Math.floor(Math.random() * LETTER_OPTIONS.length)]);
    }, 85);

    return () => clearInterval(shuffleTimerId);
  }, [roundLetter, screen]);

  function dismissScoringHelp() {
    setShowScoringHelp(false);
    if (doNotShowScoringHelpAgain) {
      setHideScoringHelpPermanently(true);
      AsyncStorage.setItem(SCORING_HELP_STORAGE_KEY, 'true').catch(() => undefined);
    }
  }

  function requestLeaveRoom() {
    scrollViewRef.current?.scrollTo({ animated: true, y: 0 });
    setShowLeaveRoomConfirm(true);
  }

  async function confirmLeaveRoom() {
    setShowLeaveRoomConfirm(false);
    await leaveRoom();
    setLeaveCooldownUntilMs(Date.now() + 10_000);
    setLeaveCooldownNowMs(Date.now());
  }

  function openCurrentRoom() {
    if (!room) {
      return;
    }

    gameAudio.playTap();

    if (isMatchComplete || room.status === 'finished') {
      setScreen('leaderboard');
      return;
    }

    if (roundSubmitted) {
      setScreen('reveal');
      return;
    }

    if (currentRound) {
      setScreen('round');
      return;
    }

    setScreen('lobby');
  }

  function openAnswerReport(onlineAnswer: (typeof onlineRevealAnswers)[number]) {
    setReportNotice('');
    setActiveReportTarget({
      answerId: onlineAnswer.id,
      details: `${onlineAnswer.category}: ${onlineAnswer.answer || 'No answer'}`,
      playerName: onlineAnswer.playerName,
      reason: 'Answer needs review',
      reportedPlayerId: onlineAnswer.playerId,
      title: 'Report answer',
    });
  }

  function getScoreReasonKey(targetId: string, category: StarterCategory) {
    return `${targetId}:${category}`;
  }

  function maybeAskScoreReason(target: Omit<ScoreReasonTarget, 'key'> & { targetId: string }) {
    if (target.verdict === 'valid') {
      setScoreReasons((currentReasons) => {
        const nextReasons = { ...currentReasons };
        delete nextReasons[getScoreReasonKey(target.targetId, target.category)];
        return nextReasons;
      });
      return;
    }

    setActiveScoreReasonTarget({
      answer: target.answer,
      category: target.category,
      key: getScoreReasonKey(target.targetId, target.category),
      playerName: target.playerName,
      verdict: target.verdict,
    });
  }

  function saveScoreReason(reason: string) {
    if (!activeScoreReasonTarget) {
      return;
    }

    setScoreReasons((currentReasons) => ({
      ...currentReasons,
      [activeScoreReasonTarget.key]: reason,
    }));
    setActiveScoreReasonTarget(null);
  }

  function openBetaFeedbackReport() {
    setReportNotice('');
    setActiveReportTarget({
      details: `Screen: ${screen}. Session: ${room?.code ?? 'unknown'}.`,
      reason: 'Beta feedback',
      title: 'Send beta feedback',
    });
  }

  async function shareRoomInvite() {
    if (!room) {
      return;
    }

    gameAudio.playTap();

    const inviteMessage = [
      `Join my ${APP_NAME} Private Brawl.`,
      `Session code: ${room.code}`,
      'Open the game, tap Private Brawl, and enter the code.',
    ].join('\n');

    try {
      await Share.share({
        message: inviteMessage,
        title: `${APP_NAME} Private Brawl ${room.code}`,
      });
    } catch {
      // The visible session code is still the fallback on unsupported web browsers.
    }
  }

  async function sendActiveReport() {
    if (!activeReportTarget) {
      return;
    }

    setIsSendingReport(true);
    setReportNotice('');

    try {
      await submitBetaReport({
        answerId: activeReportTarget.answerId,
        details: activeReportTarget.details,
        reason: activeReportTarget.reason,
        reportedPlayerId: activeReportTarget.reportedPlayerId,
      });
      setActiveReportTarget(null);
      setReportNotice('Report sent to the review queue.');
    } catch {
      setReportNotice('Could not send report.');
    } finally {
      setIsSendingReport(false);
    }
  }

  function getBotAnswerKey(botId: string, category: StarterCategory) {
    return `${botId}:${category}`;
  }

  function pickBotDisputeVote(): DisputeVote {
    const votes: DisputeVote[] = ['valid', 'variant', 'invalid'];

    return votes[Math.floor(Math.random() * votes.length)];
  }

  function getFactCheckCategoryNote(category: StarterCategory, answer: string) {
    if (isCachedWordAccepted(cachedWordBank, category, answer)) {
      return `This exact answer is already accepted for ${category} in the game word bank.`;
    }

    const knownCategories = getKnownCategoriesForAnswer(answer);

    if (knownCategories.includes(category)) {
      return `The local word bank recognises this as ${category}.`;
    }

    if (knownCategories.length) {
      return `The local word bank knows this under ${knownCategories.join('/')} rather than ${category}.`;
    }

    return `Use the meaning as evidence. Players still decide whether it fits ${category}.`;
  }

  async function openFactCheck(target: FactCheckTarget) {
    const answer = target.answer.trim();

    if (!answer) {
      return;
    }

    const requestId = factCheckRequestRef.current + 1;
    factCheckRequestRef.current = requestId;

    const categoryNote = getFactCheckCategoryNote(target.category, answer);
    const suggestions = getCachedWordSuggestions(cachedWordBank, target.category, answer)
      .map((suggestion) => (
        suggestion.category === target.category
          ? suggestion.word
          : `${suggestion.word} (${suggestion.category})`
      ));

    setActiveFactCheckTarget({ ...target, answer });
    setFactCheckResult({
      categoryNote,
      definitions: [],
      source: 'Supabase validation cache',
      status: 'loading',
      suggestions,
      verdict: 'loading',
      word: answer,
    });

    try {
      const serverResult = await checkServerWordValidation(target.category, answer, answer[0] ?? '');

      if (factCheckRequestRef.current !== requestId) {
        return;
      }

      setFactCheckResult({
        categoryNote,
        definitions: [],
        source: serverResult.source,
        status: serverResult.verdict === 'valid' || serverResult.verdict === 'invalid' ? 'found' : 'not_found',
        suggestions,
        verdict: serverResult.verdict === 'valid'
          ? 'verified'
          : serverResult.verdict === 'invalid' ? 'invalid' : 'possible',
        word: answer,
      });
    } catch {
      if (factCheckRequestRef.current !== requestId) {
        return;
      }
      setFactCheckResult({
        categoryNote,
        definitions: [],
        error: 'Could not check the server validation cache right now.',
        source: 'Supabase validation cache',
        status: 'error',
        suggestions,
        verdict: 'possible',
        word: answer,
      });
    }
  }

  function renderFactCheckButton(target: FactCheckTarget) {
    if (!target.answer.trim()) {
      return null;
    }

    return (
      <Pressable
        onPress={() => {
          gameAudio.playTap();
          openFactCheck(target);
        }}
        style={({ pressed }) => [styles.factCheckButton, pressed && styles.buttonPressed]}
      >
        <BookOpen color={INK} size={18} strokeWidth={3} />
        <Text style={styles.factCheckButtonText}>Check meaning</Text>
      </Pressable>
    );
  }

  function rememberScoredWord(category: StarterCategory, verdict: AnswerVerdict) {
    if (verdict !== 'valid' && verdict !== 'variant') {
      return;
    }

    const answer = answers[category].trim();

    if (!answer) {
      return;
    }

    rememberAcceptedWord(cachedWordBank, category, answer, `score-${verdict}`)
      .then(setCachedWordBank)
      .catch(() => undefined);
  }

  function getCpuDisputeSuggestion(category: StarterCategory): { reason: string; vote: DisputeVote } | null {
    const answer = answers[category].trim();

    if (!answer || verdicts[category] !== 'valid') {
      return null;
    }

    const duplicateCpu = findMatchingBotAnswer(answer, category, botRoundAnswers);

    if (duplicateCpu) {
      return {
        reason: `${duplicateCpu.botName} also wrote this. It counts as Shared.`,
        vote: 'variant',
      };
    }

    if (roundLetter && !answer.toUpperCase().startsWith(roundLetter)) {
      return {
        reason: `It does not start with ${roundLetter}.`,
        vote: 'invalid',
      };
    }

    if (isCachedWordAccepted(cachedWordBank, category, answer)) {
      return null;
    }

    const knownCategories = getKnownCategoriesForAnswer(answer);
    const knownInCurrentCategory = knownCategories.includes(category);
    const knownOtherCategories = knownCategories.filter((knownCategory) => knownCategory !== category);

    if (!knownInCurrentCategory && knownOtherCategories.length) {
      return {
        reason: `${answer} fits ${knownOtherCategories.join('/')} better than ${category}.`,
        vote: 'invalid',
      };
    }

    if (answer.length <= 2 || /[^a-z\s'-]/i.test(answer)) {
      return {
        reason: 'CPU is not sure this spelling should count.',
        vote: 'variant',
      };
    }

    return null;
  }

  function pickBotVoteToward(preferredVote?: DisputeVote, personality: BotPersonality = 'Agreeable'): DisputeVote {
    const followPreferredRate = {
      Aggressive: 0.82,
      Agreeable: 0.48,
      Careful: 0.76,
      Chaotic: 0.36,
      Generous: 0.44,
      Perfect: 0.72,
      Scholar: 0.78,
      Skeptical: 0.8,
      Sloppy: 0.42,
      Speedy: 0.56,
    } satisfies Record<BotPersonality, number>;

    if (preferredVote && Math.random() < followPreferredRate[personality]) {
      return preferredVote;
    }

    if (personality === 'Aggressive') {
      return Math.random() < 0.62 ? 'invalid' : 'variant';
    }

    if (personality === 'Agreeable') {
      return Math.random() < 0.72 ? 'valid' : 'variant';
    }

    if (personality === 'Careful') {
      return Math.random() < 0.62 ? 'variant' : 'valid';
    }

    if (personality === 'Chaotic') {
      return pickBotDisputeVote();
    }

    if (personality === 'Generous') {
      return Math.random() < 0.84 ? 'valid' : 'variant';
    }

    if (personality === 'Perfect') {
      return Math.random() < 0.58 ? 'valid' : 'variant';
    }

    if (personality === 'Scholar') {
      return Math.random() < 0.64 ? 'variant' : 'invalid';
    }

    if (personality === 'Skeptical') {
      return Math.random() < 0.58 ? 'invalid' : 'variant';
    }

    if (personality === 'Sloppy') {
      return pickBotDisputeVote();
    }

    if (personality === 'Speedy') {
      return Math.random() < 0.52 ? 'variant' : 'valid';
    }

    if (Math.random() < 0.55) {
      return 'variant';
    }

    return Math.random() < 0.5 ? 'valid' : 'invalid';
  }

  function createBotVoteList(preferredVote?: DisputeVote): BotTableVote[] {
    return botPlayers.map((botPlayer) => ({
      botId: botPlayer.id,
      botName: botPlayer.name,
      vote: pickBotVoteToward(preferredVote, botPlayer.personality),
    }));
  }

  function resolveTableVote(playerVote: DisputeVote, botVotes: readonly BotTableVote[]) {
    const tally: Record<DisputeVote, number> = {
      invalid: 0,
      valid: 0,
      variant: 0,
    };

    tally[playerVote] += 1;
    botVotes.forEach((botVote) => {
      tally[botVote.vote] += 1;
    });

    const highestCount = Math.max(...Object.values(tally));
    const winners = (Object.keys(tally) as DisputeVote[]).filter((vote) => tally[vote] === highestCount);

    return winners.length === 1 ? winners[0] : playerVote;
  }

  function formatDisputeVote(vote?: DisputeVote) {
    if (vote === 'valid') {
      return 'Unique';
    }

    if (vote === 'variant') {
      return 'Shared';
    }

    if (vote === 'invalid') {
      return 'No score';
    }

    return 'Pending';
  }

  function toggleDispute(category: StarterCategory) {
    const isAlreadyDisputed = disputedCategories.includes(category);

    setDisputedCategories((currentCategories) => (
      isAlreadyDisputed
        ? currentCategories.filter((currentCategory) => currentCategory !== category)
        : [...currentCategories, category]
    ));

    if (!isAlreadyDisputed && !categoryBotVoteLists[category]) {
      const currentVerdict = verdicts[category];
      const preferredVote: DisputeVote = currentVerdict === 'valid' || currentVerdict === 'variant' || currentVerdict === 'invalid'
        ? currentVerdict
        : currentVerdict === 'duplicate' ? 'variant' : 'invalid';

      setCategoryBotVoteLists((currentVoteLists) => ({
        ...currentVoteLists,
        [category]: createBotVoteList(preferredVote),
      }));
    }
  }

  function toggleBotAnswerDispute(botId: string, category: StarterCategory) {
    const disputeKey = getBotAnswerKey(botId, category);
    const isAlreadyDisputed = disputedBotAnswers.includes(disputeKey);

    setDisputedBotAnswers((currentDisputes) => (
      isAlreadyDisputed
        ? currentDisputes.filter((currentDispute) => currentDispute !== disputeKey)
        : [...currentDisputes, disputeKey]
    ));

    if (!isAlreadyDisputed) {
      const counterVote = pickBotDisputeVote();

      setBotCounterVotes((currentVotes) => ({
        ...currentVotes,
        [disputeKey]: counterVote,
      }));
      setBotAnswerBotVoteLists((currentVoteLists) => ({
        ...currentVoteLists,
        [disputeKey]: createBotVoteList(counterVote),
      }));
    }
  }

  async function castCategoryVote(category: StarterCategory, vote: DisputeVote) {
    if (room?.isOnline) {
      const ownAnswer = onlineRevealAnswers.find((answer) => answer.playerId === room.playerId && answer.category === category);
      if (ownAnswer?.dispute?.status === 'open') {
        await submitDisputeVote(ownAnswer.dispute.id, vote);
      } else {
        const result = await persistCategoryVote(category, vote, vote);
        if (!result.accepted) setChallengeResultNotice({ title: 'Vote not accepted', message: describeVoteFailure(result.error) });
      }
      return;
    }
    const botVotes = categoryBotVoteLists[category] ?? createBotVoteList(botCategoryVotes[category]);
    const finalVote = resolveTableVote(vote, botVotes);

    setCategoryPlayerVotes((currentVotes) => ({
      ...currentVotes,
      [category]: vote,
    }));
    setCategoryBotVoteLists((currentVoteLists) => ({
      ...currentVoteLists,
      [category]: botVotes,
    }));
    setCategoryVotes((currentVotes) => ({
      ...currentVotes,
      [category]: finalVote,
    }));
    updateVerdict(category, finalVote);
    rememberScoredWord(category, finalVote);
    triggerHaptic('success');
    setChallengeResultNotice({
      title: 'Challenge result',
      message: `${category} was resolved as ${formatDisputeVote(finalVote)}.`,
    });
  }

  function resolveOnlineAnswerVote(
    votes: Array<{ verdict: string; voterPlayerId: string }>,
    voterPlayerId: string,
    vote: DisputeVote,
  ) {
    const tally: Record<DisputeVote, number> = {
      invalid: 0,
      valid: 0,
      variant: 0,
    };

    votes
      .filter((currentVote) => currentVote.voterPlayerId !== voterPlayerId)
      .forEach((currentVote) => {
        if (currentVote.verdict === 'valid' || currentVote.verdict === 'variant' || currentVote.verdict === 'invalid') {
          tally[currentVote.verdict] += 1;
        }
      });
    tally[vote] += 1;

    const highestCount = Math.max(...Object.values(tally));
    const winners = (Object.keys(tally) as DisputeVote[]).filter((currentVote) => tally[currentVote] === highestCount);

    return winners.length === 1 ? winners[0] : vote;
  }

  async function castSyncedAnswerVote(
    onlineAnswer: (typeof onlineRevealAnswers)[number],
    vote: DisputeVote,
  ) {
    if (!room?.playerId) {
      return;
    }

    const finalVote = resolveOnlineAnswerVote(onlineAnswer.votes, room.playerId, vote);
    const result = await persistSyncedAnswerVote(onlineAnswer, vote, finalVote);
    if (!result.accepted) setChallengeResultNotice({ title: 'Vote not confirmed', message: describeVoteFailure(result.error) });
    return result;
  }

  async function submitDisputeVote(disputeId: string, vote: DisputeVote) {
    const outcome = await withVoteAcknowledgement(() => persistSyncedDisputeVote(disputeId, vote), (result) => {
      const warnings = [result.warning, result.refreshWarning].filter((warning) => warning !== undefined);
      setChallengeResultNotice({
        disputeId,
        title: 'Vote accepted',
        message: warnings.length
          ? `Your vote was accepted. ${warnings.map((warning) => `${warning.stage === 'refresh' ? 'Results refresh failed' : 'Challenge resolution failed'}: ${warning.message}`).join(' ')} Do not resubmit the vote.`
          : result.resolved
            ? `The server resolved the challenge as ${formatDisputeVote(result.finalVerdict as DisputeVote | undefined)}.`
            : 'Your vote was accepted. The challenge is awaiting a final server result.',
      });
    });
    if (!outcome.accepted) setChallengeResultNotice({ title: 'Vote not confirmed', message: describeVoteFailure(outcome.error) });
    return outcome;
  }

  function castBotAnswerVote(botId: string, category: StarterCategory, vote: DisputeVote) {
    const disputeKey = getBotAnswerKey(botId, category);
    const botVotes = botAnswerBotVoteLists[disputeKey] ?? createBotVoteList(botCounterVotes[disputeKey]);
    const finalVote = resolveTableVote(vote, botVotes);
    const botName = botRoundAnswers.find((answer) => answer.botId === botId)?.botName ?? 'Bot';

    setBotAnswerPlayerVotes((currentVotes) => ({
      ...currentVotes,
      [disputeKey]: vote,
    }));
    setBotAnswerBotVoteLists((currentVoteLists) => ({
      ...currentVoteLists,
      [disputeKey]: botVotes,
    }));
    setBotAnswerVotes((currentVotes) => ({
      ...currentVotes,
      [disputeKey]: finalVote,
    }));
    updateBotAnswerVerdict(botId, category, finalVote);
    triggerHaptic('success');
    setChallengeResultNotice({
      title: 'Challenge result',
      message: `${botName}'s ${category} answer was resolved as ${formatDisputeVote(finalVote)}.`,
    });
  }

  useEffect(() => {
    if (screen === 'round') {
      setDisputedCategories([]);
      setBotDisputedCategories([]);
      setDisputedBotAnswers([]);
      setCategoryVotes({});
      setCategoryPlayerVotes({});
      setBotCategoryVotes({});
      setBotCategoryDisputeReasons({});
      setCategoryBotVoteLists({});
      setBotAnswerVotes({});
      setBotAnswerPlayerVotes({});
      setBotAnswerBotVoteLists({});
      setBotCounterVotes({});
      setActiveDisputeNotice(null);
      setCpuDisputeRoundKey('');
      setDismissedMatchResultKey('');
    }
  }, [roundLetter, screen]);

  useEffect(() => {
    if (screen !== 'scoring' || scoringStep !== 'review' || !botPlayers.length) {
      return;
    }

    const roundDisputeKey = currentRound?.id ?? `${roundLetter}-${roundHistory.length}`;

    if (cpuDisputeRoundKey === roundDisputeKey) {
      return;
    }

    const challengeLimit = botDifficulty === 'Hard' ? 3 : 2;
    const disputeSuggestions = selectedCategories
      .map((category) => ({ category, suggestion: getCpuDisputeSuggestion(category) }))
      .filter((entry): entry is { category: StarterCategory; suggestion: { reason: string; vote: DisputeVote } } => (
        Boolean(entry.suggestion)
      ));
    const nextBotDisputes = disputeSuggestions
      .map((entry) => entry.category)
      .slice(0, challengeLimit);
    const nextSuggestedVotes = Object.fromEntries(
      disputeSuggestions.map((entry) => [entry.category, entry.suggestion.vote]),
    ) as Partial<Record<StarterCategory, DisputeVote>>;
    const nextDisputeReasons = Object.fromEntries(
      disputeSuggestions.map((entry) => [entry.category, entry.suggestion.reason]),
    ) as Partial<Record<StarterCategory, string>>;

    setBotDisputedCategories(nextBotDisputes);
    setBotCategoryVotes(nextSuggestedVotes);
    setBotCategoryDisputeReasons(nextDisputeReasons);
    setCategoryBotVoteLists(Object.fromEntries(
      nextBotDisputes.map((category) => [category, createBotVoteList(nextSuggestedVotes[category])]),
    ) as Partial<Record<StarterCategory, BotTableVote[]>>);
    setCpuDisputeRoundKey(roundDisputeKey);
    if (nextBotDisputes[0]) {
      setActiveDisputeNotice({
        category: nextBotDisputes[0],
        challengerName: botPlayers[0]?.name ?? 'Opponent',
        reason: nextDisputeReasons[nextBotDisputes[0]] ?? 'CPU wants the table to check this score.',
        suggestedVote: nextSuggestedVotes[nextBotDisputes[0]] ?? 'variant',
      });
    } else {
      setActiveDisputeNotice(null);
    }
  }, [botPlayers.length, botRoundAnswers, botDifficulty, cachedWordBank, cpuDisputeRoundKey, currentRound?.id, roundHistory.length, roundLetter, screen, scoringStep, selectedCategories, verdicts]);

  const resolvedNoticeDispute = challengeResultNotice?.disputeId
    ? onlineRevealAnswers.find((answer) => answer.dispute?.id === challengeResultNotice.disputeId)?.dispute
    : undefined;
  const challengeNoticeMessage = resolvedNoticeDispute?.status === 'resolved'
    ? `The server resolved the challenge as ${formatDisputeVote(resolvedNoticeDispute.finalVerdict as DisputeVote | undefined)}.`
    : challengeResultNotice?.message ?? '';

  const disputeNoticeStack = botDisputedCategories.map((category) => ({
    category,
    challengerName: botPlayers[0]?.name ?? 'Opponent',
    reason: botCategoryDisputeReasons[category] ?? 'CPU wants the table to check this score.',
    suggestedVote: botCategoryVotes[category] ?? 'variant',
  }));

  const disputeSummaryRows = [
    ...selectedCategories.flatMap((category) => {
      const hasDispute = disputedCategories.includes(category) || botDisputedCategories.includes(category);

      if (!hasDispute) {
        return [];
      }

      const vote = categoryVotes[category];
      const currentVerdict = vote ?? verdicts[category];

      return [{
        id: `player-${category}`,
        meta: botDisputedCategories.includes(category)
          ? `${botPlayers[0]?.name ?? 'Opponent'} challenged: ${formatDisputeVote(botCategoryVotes[category])}`
          : 'You asked for a table vote',
        points: scoreAnswer({ verdict: currentVerdict }),
        result: vote ? formatDisputeVote(vote) : 'Pending vote',
        title: `Your ${category}`,
      }];
    }),
    ...disputedBotAnswers.map((disputeKey) => {
      const [botId, category] = disputeKey.split(':') as [string, StarterCategory];
      const botAnswer = botRoundAnswers.find((answer) => (
        answer.botId === botId && answer.category === category
      ));
      const vote = botAnswerVotes[disputeKey];
      const currentVerdict = vote ?? botAnswer?.verdict ?? 'blank';

      return {
        id: `bot-${disputeKey}`,
        meta: `${botAnswer?.botName ?? 'Opponent'} counters: ${formatDisputeVote(botCounterVotes[disputeKey])}`,
        points: scoreAnswer({ verdict: currentVerdict }),
        result: vote ? formatDisputeVote(vote) : 'Pending vote',
        title: `${botAnswer?.botName ?? 'Opponent'} ${category}`,
      };
    }),
  ];
  const disputedPlayerCategories = Array.from(new Set([...disputedCategories, ...botDisputedCategories]));
  const unresolvedPlayerDisputeCount = disputedPlayerCategories.filter((category) => !categoryPlayerVotes[category]).length;
  const unresolvedBotAnswerDisputeCount = disputedBotAnswers.filter((disputeKey) => !botAnswerPlayerVotes[disputeKey]).length;
  const firstUnresolvedOnlineDispute = onlineRevealAnswers.find((onlineAnswer) => (
    onlineAnswer.dispute?.status === 'open'
    && !onlineAnswer.dispute.votes.some((vote) => vote.voterPlayerId === room?.playerId)
  ));
  const unresolvedOnlineDisputeCount = onlineRevealAnswers.filter((onlineAnswer) => (
    onlineAnswer.dispute?.status === 'open'
  )).length;
  const unresolvedDisputeCount = unresolvedPlayerDisputeCount + unresolvedBotAnswerDisputeCount + unresolvedOnlineDisputeCount;
  const hasUnresolvedDisputes = unresolvedDisputeCount > 0;
  const firstUnresolvedPlayerDispute = disputedPlayerCategories.find((category) => !categoryPlayerVotes[category]);
  const firstUnresolvedBotDispute = disputedBotAnswers.find((disputeKey) => !botAnswerPlayerVotes[disputeKey]);
  const firstUnresolvedDisputeId = firstUnresolvedPlayerDispute
    ? `player-${firstUnresolvedPlayerDispute}`
    : firstUnresolvedBotDispute
      ? `bot-${firstUnresolvedBotDispute}`
      : firstUnresolvedOnlineDispute?.dispute
        ? `online-${firstUnresolvedOnlineDispute.dispute.id}`
        : '';
  function scrollToFirstUnresolvedDispute() {
    if (!firstUnresolvedDisputeId) {
      return;
    }

    const y = disputePanelOffsetsRef.current[firstUnresolvedDisputeId];
    setHighlightedDisputeId(firstUnresolvedDisputeId);

    if (typeof y === 'number') {
      scrollViewRef.current?.scrollTo({ animated: true, y: Math.max(0, y - 24) });
    }
  }
  const hasHumanScoringTargets = Boolean(room?.isOnline && onlineRevealAnswers.some((onlineAnswer) => (
    onlineAnswer.playerId !== room.playerId
  )));
  const hasBotScoringTargets = botRoundAnswers.length > 0;
  const humanScoringTargetIds = Array.from(new Set(
    onlineRevealAnswers
      .filter((onlineAnswer) => onlineAnswer.playerId !== room?.playerId)
      .map((onlineAnswer) => onlineAnswer.playerId),
  ));
  const botScoringTargetIds = Array.from(new Set(
    botRoundAnswers
      .map((botAnswer) => botAnswer.botId),
  ));
  const scoringTargetSeed = `${currentRound?.id ?? roundLetter}:${room?.playerId ?? 'local'}`;
  const assignedHumanScoringTargetId = humanScoringTargetIds.length
    ? humanScoringTargetIds[stableHash(`${scoringTargetSeed}:player`) % humanScoringTargetIds.length]
    : undefined;
  const assignedBotScoringTargetId = botScoringTargetIds.length
    ? botScoringTargetIds[stableHash(`${scoringTargetSeed}:bot`) % botScoringTargetIds.length]
    : undefined;
  const assignedHumanScoringTargetName = onlineRevealAnswers.find((onlineAnswer) => (
    onlineAnswer.playerId === assignedHumanScoringTargetId
  ))?.playerName;
  const assignedBotScoringTargetName = botRoundAnswers.find((botAnswer) => (
    botAnswer.botId === assignedBotScoringTargetId
  ))?.botName;
  const mixedScoringTarget = stableHash(`${currentRound?.id ?? roundLetter}:${room?.playerId ?? 'local'}`) % 2 === 0
    ? 'bots'
    : 'players';
  const liveBrawlSystemScoresBots = room?.visibility === 'public';
  const humanScoringWork = getHumanScoringWork(onlineRevealAnswers, room?.playerId);
  const activeScoringTarget = room?.isOnline
    ? humanScoringWork.required.length ? 'players' : 'none'
    : scoringOwner === 'Self'
    ? 'self'
    : hasHumanScoringTargets && hasBotScoringTargets
      ? mixedScoringTarget
      : hasHumanScoringTargets
        ? 'players'
        : hasBotScoringTargets
        ? 'bots'
          : 'none';
  const activeScoringTargetName = activeScoringTarget === 'bots'
    ? assignedBotScoringTargetName
    : activeScoringTarget === 'players'
      ? room?.isOnline ? 'all opponents' : assignedHumanScoringTargetName
      : undefined;
  const scoringTaskTotal = room?.isOnline && scoringStep === 'score'
    ? humanScoringWork.required.length
    : scoringStep === 'score'
    ? activeScoringTarget === 'self'
      ? selectedCategories.length
      : activeScoringTarget === 'players'
        ? onlineRevealAnswers.filter((onlineAnswer) => (
          onlineAnswer.playerId === assignedHumanScoringTargetId
        )).length
        : activeScoringTarget === 'bots'
          ? botRoundAnswers.filter((botAnswer) => (
            botAnswer.botId === assignedBotScoringTargetId
          )).filter((botAnswer) => botAnswer.answer.trim()).length
          : 0
    : selectedCategories.length;
  const scoringTaskDone = room?.isOnline && scoringStep === 'score'
    ? humanScoringWork.completed
    : scoringStep === 'score'
    ? activeScoringTarget === 'self'
      ? selectedCategories.filter((category) => verdicts[category] !== 'blank').length
      : activeScoringTarget === 'players'
        ? onlineRevealAnswers.filter((onlineAnswer) => (
          onlineAnswer.playerId === assignedHumanScoringTargetId
          && onlineAnswer.votes.some((vote) => vote.voterPlayerId === room?.playerId)
        )).length
        : activeScoringTarget === 'bots'
          ? botRoundAnswers.filter((botAnswer) => (
            botAnswer.botId === assignedBotScoringTargetId
            && (liveBrawlSystemScoresBots
              ? Boolean(botAnswerPlayerVotes[getBotAnswerKey(botAnswer.botId, botAnswer.category)])
              : botAnswer.verdict !== 'blank')
        )).length
          : 0
    : selectedCategories.length - unresolvedDisputeCount;
  const scoringTaskProgress = scoringTaskTotal > 0
    ? Math.min(1, Math.max(0, scoringTaskDone / scoringTaskTotal))
    : scoringStep === 'score' && liveBrawlSystemScoresBots ? 1 : 0;
  const hasPendingSelfScores = scoringOwner === 'Self' && selectedCategories.some((category) => verdicts[category] === 'blank');
  const hasPendingLocalBotScores = !room?.isOnline && activeScoringTarget === 'bots' && botRoundAnswers.some((botAnswer) => (
    botAnswer.botId === assignedBotScoringTargetId && botAnswer.verdict === 'blank'
  ));
  const hasPendingScores = room?.isOnline
    ? humanScoringWork.pending.length > 0
    : hasPendingSelfScores || hasPendingLocalBotScores;
  const scoringDeck = scoringStep === 'score'
    ? activeScoringTarget === 'self'
      ? selectedCategories
        .map((category) => ({
          answer: answers[category].trim(),
          category,
          color: laneColor(Math.max(0, selectedCategories.indexOf(category))),
          currentVote: verdicts[category] === 'blank' || verdicts[category] === 'duplicate'
            ? undefined
            : verdicts[category] as DisputeVote,
          key: `self-${category}`,
          playerName: 'You',
          targetId: 'self',
          type: 'self' as const,
        }))
      : activeScoringTarget === 'players'
        ? humanScoringWork.required
          .map((onlineAnswer) => {
            const currentVote = onlineAnswer.votes.find((vote) => vote.voterPlayerId === room?.playerId)?.verdict as DisputeVote | undefined;

            return {
              answer: onlineAnswer.answer,
              category: onlineAnswer.category,
              color: laneColor(Math.max(0, selectedCategories.indexOf(onlineAnswer.category))),
              currentVote,
              key: onlineAnswer.id,
              onlineAnswer,
              playerName: onlineAnswer.playerName,
              targetId: onlineAnswer.playerId,
              type: 'online' as const,
            };
          })
        : activeScoringTarget === 'bots'
          ? botRoundAnswers
            .filter((botAnswer) => (
              botAnswer.botId === assignedBotScoringTargetId
            ))
            .map((botAnswer) => {
              const botAnswerKey = getBotAnswerKey(botAnswer.botId, botAnswer.category);
              const currentVote = liveBrawlSystemScoresBots
                ? botAnswerPlayerVotes[botAnswerKey]
                : botAnswer.verdict === 'blank' || botAnswer.verdict === 'duplicate'
                  ? undefined
                  : botAnswer.verdict as DisputeVote;

              return {
                answer: botAnswer.answer,
                botAnswer,
                category: botAnswer.category,
                color: laneColor(Math.max(0, selectedCategories.indexOf(botAnswer.category))),
                currentVote,
                key: botAnswerKey,
                playerName: botAnswer.botName,
                targetId: botAnswer.botId,
                type: 'bot' as const,
              };
            })
          : []
    : [];
  const activeScoreCard = scoringDeck[Math.min(scoringCardIndex, Math.max(0, scoringDeck.length - 1))] ?? null;
  const getVisibleSelfVerdict = (category: StarterCategory, ownOnlineAnswer?: (typeof onlineRevealAnswers)[number]) => {
    return room?.isOnline && ownOnlineAnswer
      ? ownOnlineAnswer.verdict
      : verdicts[category];
  };
  const reviewContext = JSON.stringify([matchResetToken, room?.id, room?.playerId,
    currentRound?.id ?? null, currentRound?.id ? null : roundHistory.length, roundLetter]);
  useEffect(() => { setReviewSelection(null); }, [reviewContext, screen, scoringStep]);
  useEffect(() => { if (challengeResultNotice) setReviewSelection(null); }, [challengeResultNotice]);
  const reviewCategoryDeck = scoringStep === 'review'
    ? buildReviewCategoryDeck({
      answers,
      assignedBotScoringTargetId,
      assignedHumanScoringTargetId,
      botRoundAnswers,
      disputedBotAnswers,
      disputedCategories,
      isOnline: Boolean(room?.isOnline),
      laneColor,
      onlineRevealAnswers,
      playerId: room?.playerId,
      scoreAnswer,
      selectedCategories,
      verdicts,
    })
    : [];
  useEffect(() => {
    if (!reviewSelection) return;
    const currentIds = reviewCategoryDeck.flatMap((card) => card.entries.map((entry) => {
      if (entry.id !== `review-self-${card.category}`) return entry.id;
      return onlineRevealAnswers.find((answer) => answer.playerId === room?.playerId && answer.category === card.category)?.id ?? entry.id;
    }));
    if (reviewSelection.context !== reviewContext || !currentIds.includes(reviewSelection.answerId)) setReviewSelection(null);
  });
  const getScoreComparisonEntries = (scoreCard: typeof activeScoreCard) => buildScoreComparisonEntries({
    answers,
    botRoundAnswers,
    isOnline: Boolean(room?.isOnline),
    onlineRevealAnswers,
    playerId: room?.playerId,
    scoreAnswer,
    scoreCard,
    verdicts,
  });

  useEffect(() => {
    if (scoringStep !== 'score') {
      return;
    }

    if (!scoringDeck.length) {
      setScoringCardIndex(0);
      return;
    }

    setScoringCardIndex((currentIndex) => Math.min(currentIndex, scoringDeck.length - 1));
  }, [scoringDeck.length, scoringStep]);

  async function scoreActiveCard(vote: DisputeVote, scoreCard = activeScoreCard, scoredIndex = scoringCardIndex) {
    if (!scoreCard) {
      return;
    }
    if (room?.isOnline && (isOnlineScoringExpired || scoringPolicy.scoringComplete || !scoringPolicy.submissionsReady)) {
      gameAudio.playTap();
      triggerHaptic('error');
      return;
    }

    gameAudio.playTap();

    if (scoreCard.type === 'self') {
      updateVerdict(scoreCard.category, vote);
      rememberScoredWord(scoreCard.category, vote);
    } else if (scoreCard.type === 'online') {
      const result = await castSyncedAnswerVote(scoreCard.onlineAnswer, vote);
      if (!result?.accepted) return;
    } else {
      setBotAnswerPlayerVotes((currentVotes) => ({
        ...currentVotes,
        [getBotAnswerKey(scoreCard.botAnswer.botId, scoreCard.category)]: vote,
      }));
      updateBotAnswerVerdict(scoreCard.botAnswer.botId, scoreCard.category, vote);
    }

    triggerHaptic(scoreCard.answer.trim() ? 'score' : 'error');
    if (scoreCard.answer.trim()) {
      maybeAskScoreReason({
        answer: scoreCard.answer,
        category: scoreCard.category,
        playerName: scoreCard.playerName,
        targetId: scoreCard.targetId,
        verdict: vote,
      });
    }

    const nextUnscoredIndex = scoringDeck.findIndex((scoreCard, index) => (
      index > scoredIndex && !scoreCard.currentVote
    ));
    if (nextUnscoredIndex >= 0) {
      setScoringCardIndex(nextUnscoredIndex);
      return;
    }

    const firstUnscoredIndex = scoringDeck.findIndex((scoreCard, index) => (
      index !== scoredIndex && !scoreCard.currentVote
    ));
    if (firstUnscoredIndex >= 0) {
      setScoringCardIndex(firstUnscoredIndex);
    }
  }

  function renderCompactReview() {
    const categories: ReviewCategory[] = reviewCategoryDeck.map((deckCard) => ({
      category: deckCard.category,
      color: deckCard.color,
      disputeCount: (
        (disputedCategories.includes(deckCard.category) || botDisputedCategories.includes(deckCard.category) ? 1 : 0)
        + disputedBotAnswers.filter((disputeKey) => disputeKey.endsWith(`:${deckCard.category}`)).length
        + onlineRevealAnswers.filter((answer) => answer.category === deckCard.category && answer.dispute).length
      ),
      hasDispute: disputedCategories.includes(deckCard.category)
        || botDisputedCategories.includes(deckCard.category)
        || disputedBotAnswers.some((disputeKey) => disputeKey.endsWith(`:${deckCard.category}`))
        || onlineRevealAnswers.some((answer) => answer.category === deckCard.category && answer.dispute),
      entries: deckCard.entries.map((entry) => {
        const onlineEntry = onlineRevealAnswers.find((answer) => entry.id === `review-self-${deckCard.category}` ? answer.playerId === room?.playerId && answer.category === deckCard.category : answer.id === entry.id);
        const botEntry = botRoundAnswers.find((answer) => `review-${answer.botId}-${answer.category}` === entry.id);
        return {
          answer: entry.answer,
          category: deckCard.category,
          id: onlineEntry?.id ?? entry.id,
          isDuplicate: entry.isDuplicate,
          isNoAnswer: entry.isNoAnswer,
          label: entry.label,
          points: entry.points,
          status: entry.verdict as ReviewAnswer['status'],
          onlineAnswerId: onlineEntry?.id,
          resolution: reviewResolution(onlineEntry?.dispute?.status,
            botEntry ? disputedBotAnswers.includes(getBotAnswerKey(botEntry.botId, deckCard.category))
              : entry.id === `review-self-${deckCard.category}` && (disputedCategories.includes(deckCard.category) || botDisputedCategories.includes(deckCard.category)),
            botEntry ? botAnswerVotes[getBotAnswerKey(botEntry.botId, deckCard.category)] : categoryVotes[deckCard.category]),
          targetId: onlineEntry?.playerId ?? botEntry?.botId,
          targetType: entry.id === `review-self-${deckCard.category}` ? 'self' : onlineEntry ? 'online' : botEntry ? 'bot' : undefined,
        };
      }),
    }));
    const allAnswers = categories.flatMap((category) => category.entries);
    const activeReviewAnswer = resolveReviewSelection(reviewSelection, reviewContext, allAnswers);
    const isWideReview = viewportWidth >= 700;
    const expandCompactReviewCategory = (category: StarterCategory) => {
      setCollapsedReviewCategories((currentCollapsedCategories) => {
        if (currentCollapsedCategories.length === 0) {
          return categories
            .filter((item) => item.category !== category)
            .map((item) => item.category);
        }

        return currentCollapsedCategories.filter((item) => item !== category);
      });
    };
    const renderCompactVoteButtons = (
      selectedVote: DisputeVote | undefined,
      onVote: (vote: DisputeVote) => void,
      disabled = false,
    ) => (
      <View style={styles.voteRow}>
        {([
          { icon: Check, label: 'Unique · 10', vote: 'valid' as const },
          { icon: Star, label: 'Shared · 5', vote: 'variant' as const },
          { icon: ShieldQuestion, label: 'No score · 0', vote: 'invalid' as const },
        ]).map((action) => {
          const ActionIcon = action.icon;

          return (
            <Pressable
              disabled={disabled}
              key={action.vote}
              onPress={() => {
                gameAudio.playTap();
                triggerHaptic('score');
                onVote(action.vote);
              }}
              style={({ pressed }) => [
                styles.voteButton,
                getScoreActionToneStyle(action.vote),
                selectedVote === action.vote && styles.voteButtonSelected,
                selectedVote === action.vote && getScoreActionSelectedToneStyle(action.vote),
                disabled && styles.disabledButton,
                pressed && !disabled && styles.buttonPressed,
              ]}
            >
              <ActionIcon color={INK} size={18} strokeWidth={3} />
              <Text style={styles.voteButtonText}>{action.label}</Text>
            </Pressable>
          );
        })}
      </View>
    );
    const renderCompactDisputeControls = (answer: ReviewAnswer) => {
      const category = answer.category as StarterCategory;

      if (answer.targetType === 'bot' && answer.targetId) {
        const disputeKey = getBotAnswerKey(answer.targetId, category);

        if (!disputedBotAnswers.includes(disputeKey)) {
          return null;
        }

        const playerVote = botAnswerPlayerVotes[disputeKey];
        const finalVote = botAnswerVotes[disputeKey];
        const botVotes = botAnswerBotVoteLists[disputeKey] ?? [];

        return (
          <View style={styles.votePanel}>
            <Text style={styles.settingRowTitle}>Vote on challenge</Text>
            <Text style={styles.settingRowMeta}>Pick the final score for {answer.label}. This updates the visible bot score immediately.</Text>
            <View style={styles.voteLedger}>
              <Text style={styles.voteLedgerText}>You: {formatDisputeVote(playerVote)}</Text>
              {botVotes.map((botVote) => (
                <Text key={`${disputeKey}-${botVote.botId}`} style={styles.voteLedgerText}>{botVote.botName}: {formatDisputeVote(botVote.vote)}</Text>
              ))}
            </View>
            {finalVote ? <Text style={styles.disputeResultText}>Majority result: {formatDisputeVote(finalVote)}</Text> : null}
            {renderCompactVoteButtons(playerVote, (vote) => castBotAnswerVote(answer.targetId!, category, vote))}
          </View>
        );
      }

      if (answer.targetType === 'online') {
        const onlineAnswer = onlineRevealAnswers.find((candidate) => candidate.id === answer.onlineAnswerId);
        const dispute = onlineAnswer?.dispute;

        if (!dispute) {
          return null;
        }

        const userVote = dispute.votes.find((vote) => vote.voterPlayerId === room?.playerId)?.verdict as DisputeVote | undefined;

        return (
          <View style={styles.votePanel}>
            <Text style={styles.settingRowTitle}>Vote on challenge</Text>
            <Text style={styles.settingRowMeta}>
              {dispute.isResolved
                ? `Resolved as ${formatDisputeVote(dispute.finalVerdict as DisputeVote | undefined)}.`
                : `${dispute.votes.length + dispute.botVoteCount}/${dispute.expectedVoteCount} votes cast.`}
            </Text>
            {renderCompactVoteButtons(userVote, (vote) => {
              void submitDisputeVote(dispute.id, vote);
            }, isOnlineDisputeExpired || dispute.status !== 'open')}
          </View>
        );
      }

      const ownOnlineAnswer = onlineRevealAnswers.find((candidate) => candidate.id === answer.onlineAnswerId);
      if (ownOnlineAnswer?.dispute) {
        const dispute = ownOnlineAnswer.dispute;
        const userVote = dispute.votes.find((vote) => vote.voterPlayerId === room?.playerId)?.verdict as DisputeVote | undefined;

        return (
          <View style={styles.votePanel}>
            <Text style={styles.settingRowTitle}>Vote on challenge</Text>
            <Text style={styles.settingRowMeta}>
              {dispute.isResolved
                ? `Resolved as ${formatDisputeVote(dispute.finalVerdict as DisputeVote | undefined)}.`
                : `${dispute.votes.length + dispute.botVoteCount}/${dispute.expectedVoteCount} votes cast.`}
            </Text>
            {renderCompactVoteButtons(userVote, (vote) => {
              void submitDisputeVote(dispute.id, vote);
            }, isOnlineDisputeExpired || dispute.status !== 'open')}
          </View>
        );
      }

      const isPlayerDisputed = disputedCategories.includes(category) || botDisputedCategories.includes(category);
      if (!isPlayerDisputed) {
        return null;
      }

      const playerVote = categoryPlayerVotes[category];
      const finalVote = categoryVotes[category];
      const botVotes = categoryBotVoteLists[category] ?? [];

      return (
        <View style={styles.votePanel}>
          <Text style={styles.settingRowTitle}>Vote on challenge</Text>
          <Text style={styles.settingRowMeta}>Pick the final score for your answer.</Text>
          <View style={styles.voteLedger}>
            <Text style={styles.voteLedgerText}>You: {formatDisputeVote(playerVote)}</Text>
            {botVotes.map((botVote) => (
              <Text key={`${category}-${botVote.botId}`} style={styles.voteLedgerText}>{botVote.botName}: {formatDisputeVote(botVote.vote)}</Text>
            ))}
          </View>
          {finalVote ? <Text style={styles.disputeResultText}>Majority result: {formatDisputeVote(finalVote)}</Text> : null}
          {renderCompactVoteButtons(playerVote, (vote) => castCategoryVote(category, vote))}
        </View>
      );
    };
    const details = activeReviewAnswer ? (
      <AnswerDetails
        answer={activeReviewAnswer}
        challengeControls={renderCompactDisputeControls(activeReviewAnswer)}
        onCheckMeaning={!activeReviewAnswer.isNoAnswer ? () => openFactCheck({
          answer: activeReviewAnswer.answer,
          category: activeReviewAnswer.category as StarterCategory,
          playerName: activeReviewAnswer.label,
        }) : undefined}
        onChallenge={() => {
          const category = activeReviewAnswer.category as StarterCategory;
          triggerHaptic('dispute');
          expandCompactReviewCategory(category);
          if (activeReviewAnswer.targetType === 'bot' && activeReviewAnswer.targetId) {
            toggleBotAnswerDispute(activeReviewAnswer.targetId, category);
          } else if (activeReviewAnswer.targetType === 'online' && activeReviewAnswer.targetId) {
            const onlineAnswer = onlineRevealAnswers.find((answer) => answer.id === activeReviewAnswer.onlineAnswerId);
            if (onlineAnswer) openSyncedAnswerDispute(onlineAnswer);
          } else if (activeReviewAnswer.targetType === 'self') {
            const onlineAnswer = onlineRevealAnswers.find((answer) => answer.id === activeReviewAnswer.onlineAnswerId);
            if (room?.isOnline) {
              if (onlineAnswer) openSyncedAnswerDispute(onlineAnswer);
            } else toggleDispute(category);
          }
        }}
      />
    ) : null;

    return (
      <View style={styles.compactReviewShell}>
        <ReviewSummary answers={allAnswers} />
        <View style={[styles.compactReviewColumns, isWideReview && styles.compactReviewColumnsWide]}>
          <View style={styles.compactReviewList}>
            {categories.map((category) => (
              <CategoryReviewCard
                key={category.category}
                category={category}
                expanded={collapsedReviewCategories.length === 0
                  ? category.category === categories[0]?.category
                  : !collapsedReviewCategories.includes(category.category)}
                onToggle={() => setCollapsedReviewCategories((current) => {
                  if (current.length === 0) {
                    return categories
                      .filter((item) => item.category !== category.category)
                      .map((item) => item.category);
                  }

                  return current.includes(category.category)
                    ? current.filter((item) => item !== category.category)
                    : [...current, category.category];
                })}
                onSelectAnswer={(answer) => setReviewSelection({ context: reviewContext, answerId: answer.id })}
                selectedAnswerId={activeReviewAnswer?.id}
              />
            ))}
          </View>
          {isWideReview ? <View style={styles.compactReviewDetails}>{details || <View style={styles.emptyDetails}><Text style={styles.emptyDetailsTitle}>Select an answer</Text><Text style={styles.emptyDetailsCopy}>Tap any row to inspect its score, check its meaning, or open a challenge.</Text></View>}</View> : null}
        </View>
        <RoundTotal
          total={totalScore}
          disabled={!scoringPolicy.canFinish}
          label={finishLabel}
          onFinish={scoringNavigation.finish}
        />
        {reviewDetailsVisible(isWideReview, Boolean(activeReviewAnswer), Boolean(challengeResultNotice)) ? (
          <Modal animationType="slide" transparent visible onRequestClose={() => setReviewSelection(null)}>
            <View style={styles.reviewDetailsBackdrop}><View style={styles.reviewDetailsSheet}><Pressable accessibilityLabel="Close answer details" onPress={() => setReviewSelection(null)} style={styles.reviewDetailsClose}><Text style={styles.reviewDetailsCloseText}>Close</Text></Pressable>{details}</View></View>
          </Modal>
        ) : null}
      </View>
    );
  }

  function renderScoringSwipeDeck() {
    if (scoringStep !== 'score' || !activeScoreCard) {
      return null;
    }

    const cardWidth = Platform.OS === 'web'
      ? isDesktopWeb ? 980 : isCompactWeb ? Math.max(280, viewportWidth - 80) : 680
      : isNarrowScoring ? Math.max(300, viewportWidth - 32) : 316;
    const snapInterval = cardWidth + 12;
    const goToCard = (index: number) => {
      if (!scoringDeck.length) {
        return;
      }

      const nextIndex = Math.min(Math.max(index, 0), scoringDeck.length - 1);
      gameAudio.playTap();
      setScoringCardIndex(nextIndex);
      scoreDeckScrollRef.current?.scrollTo({
        animated: true,
        x: nextIndex * snapInterval,
        y: 0,
      });
    };

    return (
      <View style={styles.scoreSwipeWrap}>
        <View style={styles.dashboardTopLine}>
          <Text style={styles.dashboardLabel}>Score answers</Text>
          <Text style={styles.dashboardStatus}>{scoringCardIndex + 1} of {Math.max(scoringDeck.length, 1)}</Text>
        </View>
        <ScrollView
          ref={scoreDeckScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          snapToInterval={snapInterval}
          decelerationRate="fast"
          contentContainerStyle={styles.scoreSwipeTrack}
          onMomentumScrollEnd={(event) => {
            const nextIndex = Math.round(event.nativeEvent.contentOffset.x / snapInterval);
            setScoringCardIndex(Math.min(Math.max(nextIndex, 0), scoringDeck.length - 1));
          }}
        >
          {scoringDeck.map((scoreCard, index) => {
            const comparisonEntries = getScoreComparisonEntries(scoreCard);
            const hasAnswer = Boolean(scoreCard.answer.trim());

            return (
              <Pressable
                key={scoreCard.key}
                onPress={() => {
                  gameAudio.playTap();
                  setScoringCardIndex(index);
                }}
                style={({ pressed }) => [
                  styles.scoreSwipeCard,
                  Platform.OS === 'web' && (
                    isDesktopWeb
                      ? styles.webScoreSwipeCard
                      : isCompactWeb
                        ? styles.webScoreSwipeCardMobile
                        : styles.webScoreSwipeCardTablet
                  ),
                  { width: cardWidth },
                  Platform.OS !== 'web' && isNarrowScoring && { width: Math.max(300, viewportWidth - 32) },
                  { backgroundColor: scoreCard.color },
                  index === scoringCardIndex && styles.scoreSwipeCardActive,
                  pressed && styles.buttonPressed,
                ]}
              >
                <View style={styles.dashboardTopLine}>
                  <Text style={styles.scoreSideCategory}>{scoreCard.category}</Text>
                  <Text style={styles.scoreSideVerdict}>
                    {scoreCard.currentVote ? formatDisputeVote(scoreCard.currentVote) : 'Pending'}
                  </Text>
                </View>
                <View style={[styles.scoreCardBodyRow, Platform.OS === 'web' && styles.webScoreCardBodyRow, isNarrowScoring && styles.scoreCardBodyColumn, Platform.OS === 'web' && !isDesktopWeb && styles.webScoreCardBodyColumn]}>
                  <View style={[styles.scorePrimaryPane, Platform.OS === 'web' && styles.webScorePrimaryPane, isNarrowScoring && styles.scorePaneStacked, Platform.OS === 'web' && !isDesktopWeb && styles.webScorePaneStacked]}>
                    <View style={styles.scorePaneHeading}><Target color={INK} size={20} strokeWidth={3} /><Text style={styles.webSelectedAnswerLabel}>Selected answer</Text></View>
                    <Text style={styles.scoreFocusPlayer}>{scoreCard.playerName}</Text>
                    <Text style={hasAnswer ? styles.scoreFocusAnswer : styles.scoreFocusNoAnswer} numberOfLines={2}>
                      {hasAnswer ? scoreCard.answer : 'No answer'}
                    </Text>
                    <Text style={styles.scoreFocusHint}>
                      {room?.isOnline && scoringPolicy.scoringComplete ? 'Required scoring is recorded. Continue to Review.' : hasAnswer ? 'Choose one score below.' : 'Blank answer. Choose 0.'}
                    </Text>
                    {hasAnswer ? (
                      <View style={styles.answerToolRow}>
                        {renderFactCheckButton({
                          answer: scoreCard.answer,
                          category: scoreCard.category,
                          playerName: scoreCard.playerName,
                        })}
                      </View>
                    ) : null}
                    <View style={styles.scoreFocusButtonGrid}>
                      {([
                        { icon: Check, label: '10 · Unique', vote: 'valid' as const },
                        { icon: Star, label: '5 · Shared', vote: 'variant' as const },
                        { icon: ShieldQuestion, label: '0 · No score', vote: 'invalid' as const },
                      ]).map((action) => {
                        const ActionIcon = action.icon;
                        const isSelected = scoreCard.currentVote === action.vote;
                        const isDisabled = isOnlineScoringExpired || (room?.isOnline && (scoringPolicy.scoringComplete || !scoringPolicy.submissionsReady)) || (!hasAnswer && action.vote !== 'invalid');

                        return (
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Score ${scoreCard.category} for ${scoreCard.playerName}: ${action.label}`}
                            accessibilityState={{ disabled: isDisabled, selected: isSelected }}
                            disabled={isDisabled}
                            key={action.vote}
                            onPress={() => scoreActiveCard(action.vote, scoreCard, index)}
                            style={({ pressed }) => [
                              styles.scoreFocusButton,
                              styles.scoreDeckVoteButton,
                              Platform.OS === 'web' && styles.webScoreDeckVoteButton,
                              isCompactWeb && styles.webScoreDeckVoteButtonMobile,
                              getScoreActionToneStyle(action.vote),
                              isSelected && styles.scoreFocusButtonSelected,
                              isSelected && getScoreActionSelectedToneStyle(action.vote),
                              isDisabled && styles.scoreFocusButtonDisabled,
                              pressed && !isDisabled && styles.buttonPressed,
                            ]}
                          >
                            <ActionIcon color={isDisabled ? '#7B8794' : isSelected ? '#FFFFFF' : INK} size={19} strokeWidth={3} />
                            <Text style={[styles.scoreFocusButtonText, isSelected && styles.scoreFocusButtonTextSelected]}>
                              {action.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                  <View style={[styles.scoreComparePane, Platform.OS === 'web' && styles.webScoreComparePane, isNarrowScoring && styles.scorePaneStacked, Platform.OS === 'web' && !isDesktopWeb && styles.webScorePaneStacked]}>
                    <View style={styles.scorePaneHeading}><Users color={INK} size={20} strokeWidth={3} /><Text style={styles.scoreCompareTitle}>Other answers</Text></View>
                    {comparisonEntries.length ? comparisonEntries.map((entry) => (
                      <View
                        key={entry.id}
                        style={[
                          styles.scoreCompareRow,
                          entry.isMatch && styles.scoreCompareRowMatch,
                        ]}
                      >
                        <View style={styles.scoreCompareNameBlock}>
                          <Text style={styles.scoreCompareName} numberOfLines={1}>{entry.label}</Text>
                          <Text style={styles.scoreSideVerdict}>{entry.points}</Text>
                        </View>
                        <Text style={[styles.scoreCompareAnswer, Platform.OS === 'web' && styles.webScoreCompareAnswer]} numberOfLines={2}>{entry.answer}</Text>
                      </View>
                    )) : (
                      <Text style={styles.scoreCompareEmpty}>No other answers yet.</Text>
                    )}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.scoreCarouselControls}>
          <Pressable
            accessibilityLabel="Previous answer to score"
            accessibilityRole="button"
            disabled={scoringCardIndex === 0}
            {...({ onKeyDown: (event: any) => {
              if ((event?.key ?? event?.nativeEvent?.key) === 'ArrowLeft') goToCard(scoringCardIndex - 1);
            } } as any)}
            onPress={() => goToCard(scoringCardIndex - 1)}
            style={({ pressed }) => [styles.scoreCarouselArrow, scoringCardIndex === 0 && styles.scoreCarouselArrowDisabled, pressed && styles.buttonPressed]}
          >
            <ChevronLeft color={INK} size={20} strokeWidth={3} />
            <Text style={styles.scoreCarouselArrowText}>Previous</Text>
          </Pressable>
          <View style={styles.scoreDeckDots}>
            {scoringDeck.map((scoreCard, index) => (
              <Pressable
                key={`dot-${scoreCard.key}`}
                accessibilityLabel={`Go to answer ${index + 1} of ${scoringDeck.length}`}
                accessibilityRole="button"
                onPress={() => goToCard(index)}
                style={[
                  styles.scoreDeckDot,
                  { backgroundColor: scoreCard.color },
                  index === scoringCardIndex && styles.scoreDeckDotActive,
                  index < scoringCardIndex && styles.scoreDeckDotCompleted,
                ]}
              />
            ))}
          </View>
          <Pressable
            accessibilityLabel="Next answer to score"
            accessibilityRole="button"
            disabled={scoringCardIndex >= scoringDeck.length - 1}
            {...({ onKeyDown: (event: any) => {
              if ((event?.key ?? event?.nativeEvent?.key) === 'ArrowRight') goToCard(scoringCardIndex + 1);
            } } as any)}
            onPress={() => goToCard(scoringCardIndex + 1)}
            style={({ pressed }) => [styles.scoreCarouselArrow, scoringCardIndex >= scoringDeck.length - 1 && styles.scoreCarouselArrowDisabled, pressed && styles.buttonPressed]}
          >
            <Text style={styles.scoreCarouselArrowText}>Next</Text>
            <ChevronRight color={INK} size={20} strokeWidth={3} />
          </Pressable>
        </View>
      </View>
    );
  }

  function renderDisputeFocusCard(target: {
    answer: string;
    category: StarterCategory;
    currentVerdict?: AnswerVerdict;
    playerName: string;
    points?: number;
  }) {
    return (
      <View style={styles.disputeFocusCard}>
        <View style={styles.dashboardTopLine}>
          <Text style={styles.scoreSideCategory}>{target.category}</Text>
          <Text style={styles.scoreSideVerdict}>
            {target.currentVerdict && target.currentVerdict !== 'blank'
              ? VERDICT_LABELS[target.currentVerdict] ?? target.currentVerdict
              : 'Pending'}
          </Text>
        </View>
        <Text style={styles.scoreFocusPlayer}>{target.playerName}</Text>
        <Text style={styles.scoreFocusAnswer} numberOfLines={2}>{target.answer || 'No answer'}</Text>
        <View style={styles.disputeFocusActions}>
          {renderFactCheckButton({
            answer: target.answer,
            category: target.category,
            playerName: target.playerName,
          })}
          {typeof target.points === 'number' ? (
            <View style={[styles.pointsBadgeSmall, getScoreToneStyle(target.currentVerdict ?? 'blank')]}>
              <Text style={styles.botAnswerPoints}>{target.points}</Text>
            </View>
          ) : null}
        </View>
      </View>
    );
  }
  const localStandingScores = new Map(localMatchStandings.map((entry) => [entry.id, entry.score]));
  const currentLeaderboardPlayerId = room?.isOnline ? room.playerId : 'player';
  const localPlayerScore = localStandingScores.get(currentLeaderboardPlayerId ?? 'player') ?? lifetimeScore;
  const botStandingEntries = botPlayers.map((botPlayer) => ({
    id: botPlayer.id,
    label: `${botPlayer.personality} CPU`,
    name: botPlayer.name,
    score: localStandingScores.get(botPlayer.id) ?? botPlayer.totalScore,
  }));

  const leaderboardEntries = room?.isOnline
    ? [
      ...(onlineMatchStandings.length
        ? onlineMatchStandings.map((standing) => ({
      id: standing.playerId,
      label: standing.playerId === room.playerId ? 'You' : `${standing.roundsPlayed} rounds`,
      name: standing.playerName,
      score: standing.totalScore,
        }))
        : [{
          id: room.playerId ?? 'player',
          label: 'You',
          name: room.playerName,
          score: localPlayerScore,
        }]),
      ...botStandingEntries,
    ].sort((a, b) => b.score - a.score)
    : room
      ? [
      { id: 'player', label: 'You', name: room.playerName, score: localPlayerScore },
      ...botStandingEntries,
      ].sort((a, b) => b.score - a.score)
      : [];
  const leader = leaderboardEntries[0];
  const playerMatchRank = Math.max(1, leaderboardEntries.findIndex((entry) => entry.id === currentLeaderboardPlayerId) + 1);
  const resultTitle = lastMatchResult?.isWinner ? 'You won the game' : `You finished ${formatOrdinal(playerMatchRank)}`;
  const resultPositionLabel = `${playerMatchRank}/${Math.max(leaderboardEntries.length, 1)}`;
  const matchResultKey = `${roundHistory.length}-${lastMatchResult?.playerScore ?? lifetimeScore}`;
  const shouldShowMatchResultModal = screen === 'leaderboard'
    && isMatchComplete
    && Boolean(lastMatchResult)
    && dismissedMatchResultKey !== matchResultKey;
  const roomAvailabilityLabel = formatRoomAvailability(room?.expiresAt, availabilityNowMs);
  const needsPickedLetter = letterPickerMode === 'pick' && !manualRoundLetter;
  const selectedAvatar = PLAYER_AVATARS.find((avatar) => avatar.key === playerProfile.avatarKey) ?? PLAYER_AVATARS[0];
  const SelectedAvatarIcon = selectedAvatar.icon;
  const playerLeague = getLeague(playerProfile.allTimePoints);
  const nextLeague = LEAGUES.find((league) => league.minScore > playerProfile.allTimePoints);
  const pointsToNextLeague = nextLeague ? nextLeague.minScore - playerProfile.allTimePoints : 0;
  const lobbyHumanNames = room
    ? room.playerNames?.length ? room.playerNames : [room.playerName]
    : [];
  const plannedLobbyBotFillCount = room?.visibility === 'public' && room.status === 'lobby'
    ? Math.max(0, Math.min(LIVE_BRAWL_TARGET_PLAYERS, LIVE_BRAWL_TARGET_PLAYERS - room.playerCount - botPlayers.length))
    : 0;
  const liveBrawlEstimatedStartSeconds = room?.visibility === 'public'
    ? (plannedLobbyBotFillCount + 1) * LIVE_BRAWL_BOT_FILL_SECONDS
    : 0;
  const matchmakingLeagueLabel = playerLeague.name;
  const lobbyRosterEntries = room
    ? [
      ...lobbyHumanNames.map((name, index) => {
        const isYou = name === room.playerName;
        const standing = onlineMatchStandings.find((entry) => entry.playerName === name);

        return {
          id: `${name}-${index}`,
          isHost: room.visibility !== 'public' && name === room.hostName,
          isPending: false,
          isYou,
          meta: isYou
            ? `${playerLeague.name} League`
            : room.visibility === 'public'
              ? 'Brawler'
              : `${name === room.hostName ? 'Host · ' : ''}Rookie League`,
          name,
          score: standing?.totalScore ?? (isYou ? localPlayerScore : 0),
          type: 'player' as const,
        };
      }),
      ...botPlayers.map((botPlayer) => ({
        id: botPlayer.id,
        isHost: false,
        isPending: false,
        isYou: false,
        meta: botPlayer.personality + ' ' + botDifficulty + ' CPU',
        name: botPlayer.name,
        score: botPlayer.totalScore,
        type: 'bot' as const,
      })),
      ...(room.visibility === 'public' ? [] : Array.from({ length: plannedLobbyBotFillCount }, (_, index) => {
        const personalitySeed = stableHash(`${room.id ?? room.code}:${botPlayers.length}:${index}`);
        const personality = LOBBY_BOT_FILL_PERSONALITIES[personalitySeed % LOBBY_BOT_FILL_PERSONALITIES.length];

        return {
          id: `pending-bot-${index + 1}`,
          isHost: false,
          isPending: true,
          isYou: false,
          meta: `${personality} ${botDifficulty} CPU`,
          name: `CPU joining ${index + 1}`,
          score: 0,
          type: 'bot' as const,
        };
      })),
    ]
    : [];
  const privateHumanCount = lobbyRosterEntries.filter((entry) => entry.type === 'player').length;
  const privatePlayersNeeded = Math.max(0, 2 - privateHumanCount);
  const shouldWarnBeforeLeavingActiveGame = Boolean(room && !isMatchComplete && (currentRound || room.status === 'in_round' || room.status === 'revealing'));
  const generalLeaderboardEntries = [
    {
      id: 'you',
      meta: `${playerLeague.name} League`,
      name: playerName.trim() || 'You',
      score: playerProfile.allTimePoints,
    },
    ...SEEDED_GLOBAL_PLAYERS,
  ].sort((a, b) => b.score - a.score);
  const playerGlobalRank = generalLeaderboardEntries.findIndex((entry) => entry.id === 'you') + 1;
  const homeLeaderboardPreview = generalLeaderboardEntries.slice(0, 3);
  const onlinePlayerScoreboardEntries = onlineRoundScores.length
    ? onlineRoundScores
    : room?.isOnline
      ? [{
        answeredCount,
        playerId: room.playerId ?? 'player',
        playerName: room.playerName,
        score: totalScore,
      }]
      : [];
  const onlineScoreboardEntries = room?.isOnline
    ? [
      ...onlinePlayerScoreboardEntries,
      ...botPlayers.map((botPlayer) => ({
        answeredCount: countAnsweredBotAnswers(botRoundAnswers, botPlayer.id),
        playerId: botPlayer.id,
        playerName: botPlayer.name,
        score: botPlayer.lastScore,
      })),
    ].sort((a, b) => b.score - a.score || a.playerName.localeCompare(b.playerName))
    : onlinePlayerScoreboardEntries;
  const isLiveTableLobby = Boolean(room?.visibility === 'public' && room.status === 'lobby' && !currentRound);
  const isOnlineNonHost = Boolean(room?.isOnline && room.visibility !== 'public' && !room.isHost);
  const canManageBrawl = !isLiveTableLobby && (!room?.isOnline || Boolean(room.isHost && room.status === 'lobby' && !room.setupLocked && !currentRound));
  const canEditRoomSetup = canManageBrawl && isEditingBrawl && !isSavingBrawl;
  const isOnlineLetterPicker = room?.isOnline
    ? room.letterPickerPlayerId === room.playerId || (!room.letterPickerPlayerId && room.isHost)
    : true;
  const isOnlineNonPicker = Boolean(room?.isOnline && !isOnlineLetterPicker);
  const canEditLetterPicker = !isOnlineNonPicker && (showNextLetterModal || canManageBrawl);
  const currentRoundPickerName = currentRound?.startedByPlayerName
    ?? (currentRound?.startedByPlayerId && currentRound.startedByPlayerId === room?.playerId ? room.playerName : undefined);
  const pendingSubmitterLabel = formatNameList(onlineRoundAgreement.pendingSubmitterNames);
  const pendingVoterLabel = formatNameList(onlineRoundAgreement.pendingVoterNames);
  const pendingDisputeVoterLabel = formatNameList(onlineRoundAgreement.pendingDisputeVoterNames);
  const onlineSubmittedTarget = onlineRoundAgreement.activePlayerCount || room?.playerCount || 0;
  const hasEveryOnlinePlayerSubmitted = !room?.isOnline
    || (onlineSubmittedTarget > 0 && onlineRoundAgreement.submittedPlayerCount >= onlineSubmittedTarget);
  const onlineTimeoutPhase = getTimeoutPhase({
    activePlayerCount: onlineRoundAgreement.activePlayerCount,
    expectedVoteCount: onlineRoundAgreement.expectedVoteCount,
    openDisputeCount: onlineRoundAgreement.openDisputeCount,
    submittedPlayerCount: onlineRoundAgreement.submittedPlayerCount,
    voteCount: onlineRoundAgreement.voteCount,
  });
  const onlinePhaseDeadline = getPhaseDeadline(onlineTimeoutPhase, {
    disputeEndsAt: onlineRoundAgreement.disputeEndsAt,
    scoringEndsAt: onlineRoundAgreement.scoringEndsAt,
  });
  const onlineCountdownState = getCountdownState({
    deadlineIso: onlinePhaseDeadline,
    error: roomError && (screen === 'reveal' || screen === 'scoring') ? roomError : null,
    isLoading: Boolean(room?.isOnline && (screen === 'reveal' || screen === 'scoring') && onlineTimeoutPhase !== 'complete' && !onlinePhaseDeadline),
    nowMs: phaseCountdownNowMs,
    phaseComplete: onlineRoundAgreement.isRoundReady || onlineTimeoutPhase === 'complete',
  });
  const isOnlineScoringExpired = onlineTimeoutPhase === 'scoring' && onlineCountdownState.status === 'expired';
  const isOnlineDisputeExpired = onlineTimeoutPhase === 'dispute' && onlineCountdownState.status === 'expired';
  const scoringPolicy = getScoringReadiness({
    online: Boolean(room?.isOnline), playerId: room?.playerId, answers: onlineRevealAnswers,
    agreement: onlineRoundAgreement, busy: isRoundBusy, mayFinish: !isOnlineNonHost,
    localPendingScores: hasPendingScores, localOpenDisputes: hasUnresolvedDisputes,
  });
  const scoringNavigation = createScoringNavigation(scoringPolicy, () => {
    gameAudio.playTap();
    setScoringStep('review');
    setScoringCardIndex(0);
  }, () => {
    gameAudio.playReveal();
    void finishRound();
  });
  const phasePresentation = scoringPhasePresentation(onlineCountdownState.status, onlineCountdownState.label, onlineRoundAgreement.isRoundReady && scoringPolicy.submissionsReady && humanScoringWork.pending.length === 0);
  const finishDisputeCount = room?.isOnline ? onlineRoundAgreement.openDisputeCount : unresolvedDisputeCount;
  const finishLabel = isOnlineNonHost ? `Waiting for ${room?.hostName}`
    : finishDisputeCount > 0 ? `Resolve ${finishDisputeCount} dispute${finishDisputeCount === 1 ? '' : 's'}`
      : isRoundBusy ? 'Finishing round…'
        : !scoringPolicy.canFinish ? humanScoringWork.pending.length ? 'Complete required scores' : 'Waiting for other players' : 'Finish Round';
  const reviewLabel = !scoringPolicy.canReview
    ? room?.isOnline && !scoringPolicy.submissionsReady ? 'Waiting for answers'
      : room?.isOnline && (isRoundBusy || onlineTimeoutPhase === 'complete') ? 'Syncing scores' : 'Give all scores first'
    : 'Review Scores';

  const accomplishmentStars = [
    {
      color: '#FFE66D',
      icon: Star,
      label: 'First Game',
      progress: Math.min(playerProfile.gamesPlayed, 1),
      target: 1,
      unlocked: playerProfile.gamesPlayed > 0,
    },
    {
      color: '#FF9A1F',
      icon: Flame,
      label: 'Streak 3',
      progress: Math.min(playerProfile.currentStreak, 3),
      target: 3,
      unlocked: playerProfile.currentStreak >= 3,
    },
    {
      color: '#FF4F5E',
      icon: Zap,
      label: 'Hot Streak',
      progress: Math.min(playerProfile.currentStreak, 5),
      target: 5,
      unlocked: playerProfile.currentStreak >= 5,
    },
    {
      color: '#7BDFF2',
      icon: Medal,
      label: '100 Points',
      progress: Math.min(playerProfile.allTimePoints, 100),
      target: 100,
      unlocked: playerProfile.allTimePoints >= 100,
    },
    {
      color: '#B8F7D4',
      icon: Target,
      label: '500 Points',
      progress: Math.min(playerProfile.allTimePoints, 500),
      target: 500,
      unlocked: playerProfile.allTimePoints >= 500,
    },
    {
      color: '#214E9C',
      icon: Crown,
      label: '1K Points',
      progress: Math.min(playerProfile.allTimePoints, 1000),
      target: 1000,
      unlocked: playerProfile.allTimePoints >= 1000,
    },
    {
      color: '#B8F7D4',
      icon: Gamepad2,
      label: '5 Games',
      progress: Math.min(playerProfile.gamesPlayed, 5),
      target: 5,
      unlocked: playerProfile.gamesPlayed >= 5,
    },
    {
      color: '#D7B8FF',
      icon: Trophy,
      label: '10 Games',
      progress: Math.min(playerProfile.gamesPlayed, 10),
      target: 10,
      unlocked: playerProfile.gamesPlayed >= 10,
    },
  ];
  const unlockedAchievementCount = accomplishmentStars.filter((achievement) => achievement.unlocked).length;
  const SelectedModeIcon = selectedMode?.icon;
  function renderLetterPickerCard() {
    return (
      <View style={styles.letterPickerCard}>
        <View style={styles.dashboardTopLine}>
          <Text style={styles.dashboardLabel}>
            {room
              ? room.isOnline
                ? `${room.letterPickerName ?? room.hostName} picks`
                : `${room.playerName} picks`
              : 'Next letter'}
          </Text>
          <Text style={styles.dashboardStatus}>
            {letterPickerMode === 'pick' ? manualRoundLetter || 'Choose' : 'Random'}
          </Text>
        </View>
        <View style={styles.letterModeGrid}>
          <Pressable
            disabled={!canEditLetterPicker}
            onPress={() => {
              gameAudio.playTap();
              setLetterPickerMode('random');
              setManualRoundLetter('');
            }}
            style={({ pressed }) => [
              styles.letterModeButton,
              letterPickerMode === 'random' && styles.letterModeButtonSelected,
              !canEditLetterPicker && styles.disabledButton,
              pressed && canEditLetterPicker && styles.buttonPressed,
            ]}
          >
            <Sparkles color={INK} size={18} strokeWidth={3} />
            <Text style={styles.randomLetterText}>Random</Text>
          </Pressable>
          <Pressable
            disabled={!canEditLetterPicker}
            onPress={() => {
              gameAudio.playTap();
              setLetterPickerMode('pick');
            }}
            style={({ pressed }) => [
              styles.letterModeButton,
              letterPickerMode === 'pick' && styles.letterModeButtonSelected,
              !canEditLetterPicker && styles.disabledButton,
              pressed && canEditLetterPicker && styles.buttonPressed,
            ]}
          >
            <KeyRound color={INK} size={18} strokeWidth={3} />
            <Text style={styles.randomLetterText}>Pick a letter</Text>
          </Pressable>
        </View>
        {letterPickerMode === 'pick' ? (
          <View style={styles.letterGrid}>
            {LETTER_OPTIONS.map((letter) => (
              <Pressable
                disabled={!canEditLetterPicker}
                key={letter}
                onPress={() => {
                  gameAudio.playTap();
                  setManualRoundLetter(letter);
                }}
                style={({ pressed }) => [
                  styles.letterPickButton,
                  manualRoundLetter === letter && styles.letterPickButtonSelected,
                  !canEditLetterPicker && styles.disabledButton,
                  pressed && canEditLetterPicker && styles.buttonPressed,
                ]}
              >
                <Text style={styles.letterPickText}>{letter}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Text style={styles.helperText}>
          {isOnlineNonPicker
            ? `Waiting for ${room?.letterPickerName ?? room?.hostName ?? 'the picker'} to choose.`
            : !canEditLetterPicker
              ? 'Letter changes are locked until this round ends.'
            : 'Choose before every round. Pick a letter when you want control, or use Random to keep it moving.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.shell, styles.androidSafeArea, Platform.OS === 'web' && styles.webShell, { backgroundColor: activeTheme.background }]}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView ref={scrollViewRef} contentContainerStyle={[styles.content, Platform.OS === 'web' && styles.webContent]} keyboardShouldPersistTaps="handled">
          {screen === 'rules' ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel, Platform.OS === 'web' && styles.webRulesPanel]}>
              <View style={[styles.rulesMain, Platform.OS === 'web' && (isDesktopWeb ? styles.webRulesMain : styles.webRulesMainStacked)]}>
                <View style={[styles.rulesHero, Platform.OS === 'web' && (isDesktopWeb ? styles.webRulesHero : styles.webRulesHeroStacked)]}>
                  <View style={styles.modeIconBubble}>
                    <BrandIconMark color={INK} size={38} />
                  </View>
                  <Text style={styles.eyebrow}>Quick rules</Text>
                  <Text style={styles.heading}>How to play</Text>
                </View>

                <View style={[styles.rulesList, Platform.OS === 'web' && (isDesktopWeb ? styles.webRulesList : styles.webRulesListStacked)]}>
                  <View style={[styles.ruleRow, Platform.OS === 'web' && styles.webRuleRow, isCompactWeb && styles.webRuleRowMobile]}>
                    <Hash color={INK} size={22} strokeWidth={3} />
                    <Text style={[styles.ruleText, Platform.OS === 'web' && styles.webRuleText]}>A letter appears each round.</Text>
                  </View>
                  <View style={[styles.ruleRow, Platform.OS === 'web' && styles.webRuleRow, isCompactWeb && styles.webRuleRowMobile]}>
                    <Timer color={INK} size={22} strokeWidth={3} />
                    <Text style={[styles.ruleText, Platform.OS === 'web' && styles.webRuleText]}>Type one answer per category before time runs out.</Text>
                  </View>
                  <View style={[styles.ruleRow, Platform.OS === 'web' && styles.webRuleRow, isCompactWeb && styles.webRuleRowMobile]}>
                    <Check color={INK} size={22} strokeWidth={3} />
                    <Text style={[styles.ruleText, Platform.OS === 'web' && styles.webRuleText]}>Score answers in Reveal: valid 10, half/duplicate 5, invalid 0.</Text>
                  </View>
                  <View style={[styles.ruleRow, Platform.OS === 'web' && styles.webRuleRow, isCompactWeb && styles.webRuleRowMobile]}>
                    <Trophy color={INK} size={22} strokeWidth={3} />
                    <Text style={[styles.ruleText, Platform.OS === 'web' && styles.webRuleText]}>Highest total after the selected rounds wins.</Text>
                  </View>
                </View>
              </View>

              <Pressable
                onPress={() => {
                  gameAudio.playTap();
                  setSkipRulesOnLaunch(!skipRulesOnLaunch);
                }}
                style={({ pressed }) => [styles.checkboxRow, Platform.OS === 'web' && styles.webCheckboxRow, pressed && styles.buttonPressed]}
              >
                <View style={[styles.checkboxBox, skipRulesOnLaunch && styles.checkboxBoxChecked]}>
                  {skipRulesOnLaunch ? <Check color={INK} size={16} strokeWidth={3} /> : null}
                </View>
                <Text style={styles.checkboxText}>Do not show this on startup again</Text>
              </Pressable>

              <View style={[styles.actions, Platform.OS === 'web' && styles.webActions]}>
                <Pressable
                  onPress={() => {
                    gameAudio.playStart();
                    completeQuickRules();
                  }}
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.primaryButtonText}>Start Playing</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {screen === 'nameSetup' ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <View style={styles.rulesHero}>
                <View style={styles.modeIconBubble}>
                  <BrandIconMark color={INK} size={38} />
                </View>
                <Text style={styles.eyebrow}>Player setup</Text>
                <Text style={styles.heading}>Choose your name</Text>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Display name</Text>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={setPlayerName}
                  placeholder="Type your name"
                  placeholderTextColor="#8A867D"
                  style={styles.input}
                  value={playerName}
                />
              </View>

              <View style={styles.actions}>
                <Pressable
                  onPress={() => {
                    gameAudio.playStart();
                    finishNameSetup();
                  }}
                  style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.primaryButtonText}>Use Name</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    gameAudio.playTap();
                    chooseAnonymousName();
                  }}
                  style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.secondaryButtonText}>Play as Anonymous</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {screen === 'home' ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <View style={styles.homeTopBar}>
                <Pressable
                  accessibilityLabel="Settings"
                  onPress={() => {
                    gameAudio.playTap();
                    setScreen('settings');
                  }}
                  style={({ pressed }) => [styles.topIconButton, pressed && styles.buttonPressed]}
                >
                  <Settings color="#FFFFFF" size={24} strokeWidth={3} />
                </Pressable>

                <View style={styles.topStatPill}>
                  <Trophy color="#FFE66D" size={18} strokeWidth={3} />
                  <Text style={styles.topStatText}>{playerProfile.allTimePoints}</Text>
                </View>

                <View style={styles.topStatPill}>
                  <Flame color="#FF9A1F" size={18} strokeWidth={3} />
                  <Text style={styles.topStatText}>{playerProfile.currentStreak}</Text>
                </View>

                <Pressable
                  accessibilityLabel={room ? 'Open current brawl' : 'Private Brawl'}
                  onPress={() => {
                    if (room) {
                      openCurrentRoom();
                      return;
                    }

                    gameAudio.playTap();
                    setScreen('join');
                  }}
                  style={({ pressed }) => [
                    styles.topIconButton,
                    room && styles.openRoomTopButton,
                    pressed && styles.buttonPressed,
                  ]}
                >
                  <Users color={room ? INK : '#FFFFFF'} size={24} strokeWidth={3} />
                </Pressable>
              </View>

              <View style={styles.homeHero}>
                <DeferredImage
                  accessibilityIgnoresInvertColors
                  resizeMode="cover"
                  source={WORD_BRAWL_ART.heroPoster}
                  style={styles.homeHeroBackdrop}
                />
                <View style={styles.homeHeroScrim} />
                <View style={styles.homeHeroHeader}>
                  <View style={styles.homeHeroCopy}>
                    <Text style={styles.homeKicker}>Same letter. No mercy.</Text>
                    <DeferredImage
                      accessibilityLabel={`${APP_NAME} logo`}
                      resizeMode="contain"
                      source={WORD_BRAWL_LOGO}
                      style={styles.homeLogo}
                    />
                    <Text style={styles.homeHeroSubtitle}>Fastest fingers win.</Text>
                  </View>
                  <Pressable
                    accessibilityLabel="Change avatar"
                    onPress={() => {
                      gameAudio.playTap();
                      setShowAvatarPicker((current) => !current);
                    }}
                    style={({ pressed }) => [
                      styles.homeAvatarButton,
                      { backgroundColor: selectedAvatar.accent },
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <SelectedAvatarIcon color={INK} size={32} strokeWidth={3.1} />
                  </Pressable>
                </View>

                <View style={styles.homeHeroArtRow}>
                  <DeferredImage
                    accessibilityLabel="Word Brawl mascot"
                    resizeMode="contain"
                    source={WORD_BRAWL_ART.mascotJump}
                    style={styles.homeMascotArt}
                  />
                  <View style={styles.homeHeroTileStack}>
                    <View style={styles.tileBurst}>
                      {['W', 'O', 'R', 'D'].map((letter, index) => (
                        <View
                          key={letter}
                          style={[
                            styles.heroTile,
                            styles.homeHeroTile,
                            { backgroundColor: ['#FFE66D', '#FFFFFF', '#B8F7D4', '#FF9A8A'][index] },
                          ]}
                        >
                          <Text style={styles.heroTileText}>{letter}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.homeHeroFightLine}>
                      Fill the board, judge the answers, climb the league.
                    </Text>
                  </View>
                </View>
              </View>

              {showAvatarPicker ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionTitle}>Avatar</Text>
                    <View style={[styles.playerAvatarPreview, { backgroundColor: selectedAvatar.accent }]}>
                      <SelectedAvatarIcon color={INK} size={22} strokeWidth={3} />
                    </View>
                  </View>
                  <View style={styles.avatarPickerGrid}>
                    {PLAYER_AVATARS.map((avatar) => {
                      const AvatarIcon = avatar.icon;
                      const isSelectedAvatar = playerProfile.avatarKey === avatar.key;

                      return (
                        <Pressable
                          accessibilityLabel={`${avatar.label} avatar`}
                          key={avatar.key}
                          onPress={() => {
                            gameAudio.playTap();
                            setPlayerAvatarKey(avatar.key);
                          }}
                          style={({ pressed }) => [
                            styles.avatarOption,
                            { backgroundColor: avatar.accent },
                            isSelectedAvatar && styles.avatarOptionSelected,
                            pressed && styles.buttonPressed,
                          ]}
                        >
                          <AvatarIcon color={INK} size={24} strokeWidth={3} />
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}

              {room ? (
                <Pressable
                  onPress={openCurrentRoom}
                  style={({ pressed }) => [styles.openRoomCard, pressed && styles.buttonPressed]}
                >
                  <View style={styles.settingRowMain}>
                    <View style={styles.openRoomIcon}>
                      <Users color={INK} size={22} strokeWidth={3} />
                    </View>
                    <View style={styles.creatorCopy}>
                      <Text style={styles.settingRowTitle}>
                        {room.visibility === 'public' ? 'Live Brawl session is open' : `Private Brawl ${room.code} is open`}
                      </Text>
                      <Text style={styles.settingRowMeta}>
                        {room.status === 'finished'
                          ? 'Finished - view results or close it'
                          : currentRound
                            ? `Round active - ${roundSubmitted ? 'review scores' : 'keep playing'}`
                            : `Lobby open - ${roomAvailabilityLabel} left`}
                      </Text>
                    </View>
                  </View>
                  <ChevronRight color={INK} size={24} strokeWidth={3} />
                </Pressable>
              ) : null}

              <View style={styles.homeModeStack}>
                <Pressable
                  disabled={isRoomBusy || Boolean(room)}
                  onPress={() => {
                    if (room) {
                      openCurrentRoom();
                      return;
                    }

                    gameAudio.playStart();
                    triggerHaptic('selection');
                    joinLiveTable();
                  }}
                  style={({ pressed }) => [
                    styles.homePrimaryModeCard,
                    (isRoomBusy || room) && styles.disabledButton,
                    pressed && !isRoomBusy && !room && styles.buttonPressed,
                  ]}
                >
                  <View style={styles.homeModeIconPrimary}>
                    <Zap color={INK} size={28} strokeWidth={3} />
                  </View>
                  <View style={styles.homeModeCopy}>
                    <Text style={styles.homeModeTitle}>
                      {room ? 'Current Brawl' : isRoomBusy ? 'Finding Brawl...' : 'Play Live Brawl'}
                    </Text>
                    <Text style={styles.homeModeMeta}>Jump into public matchmaking.</Text>
                  </View>
                  <DeferredImage
                    accessibilityIgnoresInvertColors
                    resizeMode="contain"
                    source={WORD_BRAWL_ART.liveModes}
                    style={styles.homeModeArt}
                  />
                  <ChevronRight color="#FFFFFF" size={26} strokeWidth={3} />
                </Pressable>

                <Pressable
                  disabled={isRoomBusy || Boolean(room)}
                  onPress={() => {
                    gameAudio.playTap();
                    applyModeSetup(GAME_MODES[1]);
                    setSelectedMode(GAME_MODES[1]);
                    setScreen('modeDetail');
                  }}
                  style={({ pressed }) => [
                    styles.homePracticeModeCard,
                    (isRoomBusy || room) && styles.disabledModeCard,
                    pressed && !isRoomBusy && !room && styles.buttonPressed,
                  ]}
                >
                  <View style={styles.homeModeIconSecondary}>
                    <Bot color={INK} size={26} strokeWidth={3} />
                  </View>
                  <View style={styles.homeModeCopy}>
                    <Text style={styles.homeModeTitleDark}>Practice</Text>
                    <Text style={styles.homeModeMetaDark}>Warm up against CPUs.</Text>
                  </View>
                  <DeferredImage
                    accessibilityIgnoresInvertColors
                    resizeMode="contain"
                    source={WORD_BRAWL_ART.mascotReady}
                    style={styles.homeModeArt}
                  />
                  <ChevronRight color={INK} size={26} strokeWidth={3} />
                </Pressable>

                <Pressable
                  onPress={() => {
                    if (room) {
                      openCurrentRoom();
                      return;
                    }

                    gameAudio.playTap();
                    setScreen('join');
                  }}
                  style={({ pressed }) => [styles.homeSecondaryModeCard, pressed && styles.buttonPressed]}
                >
                  <View style={styles.homeModeIconSecondary}>
                    <Users color={INK} size={26} strokeWidth={3} />
                  </View>
                  <View style={styles.homeModeCopy}>
                    <Text style={styles.homeModeTitleDark}>{room ? 'Current Brawl' : 'Private Brawl'}</Text>
                    <Text style={styles.homeModeMetaDark}>Create or join with a code.</Text>
                  </View>
                  <DeferredImage
                    accessibilityIgnoresInvertColors
                    resizeMode="contain"
                    source={WORD_BRAWL_ART.roomPreview}
                    style={styles.homeModeArt}
                  />
                  <ChevronRight color={INK} size={26} strokeWidth={3} />
                </Pressable>
              </View>

              <View style={styles.homeQuickGrid}>
                <Pressable
                  onPress={() => {
                    gameAudio.playTap();
                    setScreen('globalLeaderboard');
                  }}
                  style={({ pressed }) => [styles.homeQuickTile, pressed && styles.buttonPressed]}
                >
                  <Trophy color={INK} size={24} strokeWidth={3} />
                  <Text style={styles.homeQuickTitle}>Leaders</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    gameAudio.playTap();
                    setShowAchievements((current) => !current);
                  }}
                  style={({ pressed }) => [styles.homeQuickTile, pressed && styles.buttonPressed]}
                >
                  <Medal color={INK} size={24} strokeWidth={3} />
                  <Text style={styles.homeQuickTitle}>Quests</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    gameAudio.playTap();
                    showQuickRules();
                  }}
                  style={({ pressed }) => [styles.homeQuickTile, pressed && styles.buttonPressed]}
                >
                  <BookOpen color={INK} size={24} strokeWidth={3} />
                  <Text style={styles.homeQuickTitle}>Rules</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    gameAudio.playTap();
                    setShowAdvancedModes((current) => !current);
                  }}
                  style={({ pressed }) => [styles.homeQuickTile, pressed && styles.buttonPressed]}
                >
                  <SlidersHorizontal color={INK} size={24} strokeWidth={3} />
                  <Text style={styles.homeQuickTitle}>Modes</Text>
                </Pressable>
              </View>

              {showAdvancedModes ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <View>
                    <Text style={styles.sectionTitle}>More ways to play</Text>
                    <Text style={styles.playerMeta}>Classic, marathon, and custom rule sets.</Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      gameAudio.playTap();
                      setShowAdvancedModes(false);
                    }}
                    style={({ pressed }) => [styles.smallActionButton, pressed && styles.buttonPressed]}
                  >
                    <Text style={styles.smallActionButtonText}>Hide</Text>
                  </Pressable>
                </View>
                <View style={styles.modeGrid}>
                  {GAME_MODES.filter((mode) => mode.label !== 'Practice').map((mode) => {
                    const ModeIcon = mode.icon;

                    return (
                      <Pressable
                        disabled={isRoomBusy || Boolean(room)}
                        key={mode.label}
                        onPress={() => {
                          gameAudio.playTap();
                          setSelectedMode(mode);
                          setScreen('modeDetail');
                        }}
                        style={({ pressed }) => [
                          styles.modeCard,
                          { backgroundColor: mode.accent },
                          pressed && !isRoomBusy && !room && styles.buttonPressed,
                          (isRoomBusy || room) && styles.disabledModeCard,
                        ]}
                      >
                        <View style={styles.modeIconBubble}>
                          <ModeIcon color={INK} size={34} strokeWidth={3} />
                        </View>
                        <View>
                          <Text style={styles.modeTitle}>{mode.label}</Text>
                          <Text style={styles.modeMeta}>
                            {room ? `Close session ${room.code} first` : mode.description}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              ) : null}

              {showAchievements ? (
                <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <View>
                    <Text style={styles.sectionTitle}>Quests</Text>
                    <Text style={styles.playerMeta}>
                      {unlockedAchievementCount}/{accomplishmentStars.length} badges unlocked
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      gameAudio.playTap();
                      setShowAchievements((current) => !current);
                    }}
                    style={({ pressed }) => [styles.smallActionButton, pressed && styles.buttonPressed]}
                  >
                    <Text style={styles.smallActionButtonText}>
                      {showAchievements ? 'Hide' : 'Show'}
                    </Text>
                  </Pressable>
                </View>
                <View style={styles.accomplishmentGrid}>
                  {accomplishmentStars.map((achievement) => {
                    const AchievementIcon = achievement.icon;
                    const achievementProgress = achievement.target
                      ? Math.min(1, achievement.progress / achievement.target)
                      : 0;

                    return (
                      <View
                        key={achievement.label}
                        style={[
                          styles.accomplishmentTile,
                          achievement.unlocked && { backgroundColor: achievement.color },
                        ]}
                      >
                        <View style={styles.accomplishmentIconBadge}>
                          <AchievementIcon color={INK} size={22} strokeWidth={3} />
                        </View>
                        <View style={styles.accomplishmentCopy}>
                          <Text style={styles.accomplishmentTitle}>{achievement.label}</Text>
                          <Text style={styles.playerMeta}>
                            {achievement.unlocked ? 'Unlocked' : `${achievement.progress}/${achievement.target}`}
                          </Text>
                          <View style={styles.accomplishmentTrack}>
                            <View
                              style={[
                                styles.accomplishmentProgress,
                                {
                                  backgroundColor: achievement.unlocked ? '#1F2430' : achievement.color,
                                  width: `${achievement.unlocked ? 100 : achievementProgress * 100}%`,
                                },
                              ]}
                            />
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
              ) : null}

              {roomError ? <Text style={styles.errorText}>{roomError}</Text> : null}

              <Pressable
                onPress={() => {
                  gameAudio.playTap();
                  setScreen('globalLeaderboard');
                }}
                style={({ pressed }) => [styles.section, pressed && styles.buttonPressed]}
              >
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>League table</Text>
                  <ChevronRight color={INK} size={24} strokeWidth={3} />
                </View>
                <View style={styles.leagueSummaryCard}>
                  <View style={[styles.leagueTrophy, { backgroundColor: playerLeague.color }]}>
                    <Trophy color={INK} size={26} strokeWidth={3} />
                  </View>
                  <View style={styles.creatorCopy}>
                    <Text style={styles.settingRowTitle}>{playerLeague.name} League</Text>
                    <Text style={styles.settingRowMeta}>
                      Rank #{playerGlobalRank} - {nextLeague ? `${pointsToNextLeague} pts to ${nextLeague.name}` : 'Top trophy unlocked'}
                    </Text>
                  </View>
                </View>
                {homeLeaderboardPreview.map((entry, index) => (
                  <View
                    key={entry.id}
                    style={[styles.generalLeaderRow, entry.id === 'you' && styles.generalLeaderRowActive]}
                  >
                    <View style={styles.settingRowMain}>
                      {entry.id === 'you' ? (
                        <View style={[styles.rankBadge, { backgroundColor: selectedAvatar.accent }]}>
                          <SelectedAvatarIcon color={INK} size={19} strokeWidth={3} />
                        </View>
                      ) : (
                        <View style={styles.rankBadge}>
                          <Text style={styles.rankBadgeText}>{index + 1}</Text>
                        </View>
                      )}
                      <View>
                        <Text style={styles.historyTitle}>{entry.name}</Text>
                        <Text style={styles.playerMeta}>{entry.meta}</Text>
                      </View>
                    </View>
                    <Text style={styles.pointsText}>{entry.score}</Text>
                  </View>
                ))}
              </Pressable>

            </View>
          ) : null}

          {screen === 'modeDetail' && selectedMode ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <View style={styles.screenTopBar}>
                <Pressable
                  accessibilityLabel="Back"
                  onPress={() => {
                    gameAudio.playTap();
                    setScreen('home');
                  }}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
                >
                  <ArrowLeft color={INK} size={24} strokeWidth={3} />
                </Pressable>
                <View style={styles.screenTitleBlock}>
                  <Text style={styles.eyebrow}>Mode</Text>
                  <Text style={styles.heading}>{selectedMode.label}</Text>
                </View>
              </View>

              <View style={[styles.modeDetailHero, { backgroundColor: selectedMode.accent }]}>
                <View style={styles.modeIconBubble}>
                  {SelectedModeIcon ? <SelectedModeIcon color={INK} size={38} strokeWidth={3} /> : null}
                </View>
                <Text style={styles.modeDetailTitle}>{selectedMode.description}</Text>
                <Text style={styles.modeDetailCopy}>{selectedMode.rulesSummary}</Text>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>How to play</Text>
                <View style={styles.rulesCard}>
                  <Text style={[styles.ruleText, { maxWidth: '100%', flex: 0 }]}>{selectedMode.howToPlay}</Text>
                  {selectedMode.label === 'Practice' ? (
                    <>
                      {practiceHelpExpanded ? (
                        <View style={{ gap: 8, marginTop: 10 }}>
                          <Text style={[styles.ruleText, { maxWidth: '100%', flex: 0 }]}>1. Choose your rounds, timer and categories below. Practice includes CPU rivals.</Text>
                          <Text style={[styles.ruleText, { maxWidth: '100%', flex: 0 }]}>2. Each round gives everyone the same letter. Enter one matching word in every category before the timer ends, then submit.</Text>
                          <Text style={[styles.ruleText, { maxWidth: '100%', flex: 0 }]}>3. Review the answers. Unique valid words earn full points, shared words earn fewer, and blanks or invalid words earn none. Strict scoring rejects the wrong starting letter.</Text>
                          <Text style={[styles.ruleText, { maxWidth: '100%', flex: 0 }]}>4. Use Word Check for uncertain words and challenge a score you disagree with. Finish the review to continue to the next round.</Text>
                          <Text style={[styles.ruleText, { maxWidth: '100%', flex: 0 }]}>5. The highest total after the final round wins. Practice is separate from public matchmaking.</Text>
                        </View>
                      ) : null}
                      <Pressable accessibilityRole="button" accessibilityState={{ expanded: practiceHelpExpanded }} onPress={() => setPracticeHelpExpanded((value) => !value)} style={[styles.optionPill, { marginTop: 10 }]}>
                        <Text style={styles.optionPillText}>{practiceHelpExpanded ? 'Show Less' : 'Read More'}</Text>
                      </Pressable>
                    </>
                  ) : null}
                </View>
              </View>

              <View style={styles.modeStatsGrid}>
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>
                    {selectedMode.matchDurationSeconds ? 'Match time' : 'Rounds'}
                  </Text>
                  <Text style={styles.infoValue}>
                    {selectedMode.matchDurationSeconds
                      ? formatClock(selectedMode.matchDurationSeconds)
                      : selectedMode.rounds}
                  </Text>
                </View>
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>Round timer</Text>
                  <Text style={styles.infoValue}>{selectedMode.roundSeconds}s</Text>
                </View>
              </View>

              <View style={styles.modeStatsGrid}>
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>CPUs</Text>
                  <Text style={styles.infoValue}>{selectedMode.botCount}</Text>
                </View>
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>Scoring</Text>
                  <Text style={styles.infoValue}>{selectedMode.scoringStyle}</Text>
                </View>
              </View>

              {selectedMode.label === 'Practice' ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Practice setup</Text>
                  <Text style={styles.helperText}>Tune the solo session before starting. These choices apply only to this Practice game.</Text>

                  <View style={styles.botPanel}>
                    <View style={styles.settingRowMain}>
                      <Trophy color={INK} size={24} strokeWidth={3} />
                      <View>
                        <Text style={styles.settingRowTitle}>Rounds</Text>
                        <Text style={styles.settingRowMeta}>{targetRounds} rounds</Text>
                      </View>
                    </View>
                    <View style={styles.stepper}>
                      <Pressable
                        accessibilityLabel="Fewer Practice rounds"
                        onPress={() => {
                          gameAudio.playTap();
                          setTargetRounds(targetRounds - 1, false);
                        }}
                        style={({ pressed }) => [styles.stepperButton, pressed && styles.buttonPressed]}
                      >
                        <Minus color={INK} size={18} strokeWidth={3} />
                      </Pressable>
                      <Text style={styles.stepperValue}>{targetRounds}</Text>
                      <Pressable
                        accessibilityLabel="More Practice rounds"
                        onPress={() => {
                          gameAudio.playTap();
                          setTargetRounds(targetRounds + 1, false);
                        }}
                        style={({ pressed }) => [styles.stepperButton, pressed && styles.buttonPressed]}
                      >
                        <Plus color={INK} size={18} strokeWidth={3} />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.botPanel}>
                    <View style={styles.settingRowMain}>
                      <Clock3 color={INK} size={24} strokeWidth={3} />
                      <View>
                        <Text style={styles.settingRowTitle}>Round timer</Text>
                        <Text style={styles.settingRowMeta}>{roundSeconds} seconds</Text>
                      </View>
                    </View>
                    <View style={styles.stepper}>
                      <Pressable
                        accessibilityLabel="Shorter Practice timer"
                        onPress={() => {
                          gameAudio.playTap();
                          setRoundSeconds(roundSeconds - 15, false);
                        }}
                        style={({ pressed }) => [styles.stepperButton, pressed && styles.buttonPressed]}
                      >
                        <Minus color={INK} size={18} strokeWidth={3} />
                      </Pressable>
                      <Text style={styles.stepperValue}>{roundSeconds}</Text>
                      <Pressable
                        accessibilityLabel="Longer Practice timer"
                        onPress={() => {
                          gameAudio.playTap();
                          setRoundSeconds(roundSeconds + 15, false);
                        }}
                        style={({ pressed }) => [styles.stepperButton, pressed && styles.buttonPressed]}
                      >
                        <Plus color={INK} size={18} strokeWidth={3} />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.optionGrid}>
                    {(['Easy', 'Normal', 'Hard'] as const).map((difficulty) => (
                      <Pressable
                        key={difficulty}
                        onPress={() => {
                          gameAudio.playTap();
                          setBotDifficulty(difficulty, false);
                        }}
                        style={({ pressed }) => [
                          styles.optionPill,
                          botDifficulty === difficulty && styles.optionPillSelected,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Bot color={INK} size={18} strokeWidth={3} />
                        <Text style={styles.optionPillText}>{difficulty}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionTitle}>Categories</Text>
                    <Text style={styles.playerMeta}>{selectedCategories.length} selected</Text>
                  </View>
                  <View style={styles.chipGrid}>
                    {STARTER_CATEGORIES.map((category, index) => (
                      <Pressable
                        key={category}
                        onPress={() => {
                          gameAudio.playTap();
                          toggleSelectedCategory(category);
                        }}
                        style={({ pressed }) => [
                          styles.chip,
                          { backgroundColor: selectedCategories.includes(category) ? laneColor(index) : '#FFFFFF' },
                          !selectedCategories.includes(category) && styles.chipUnselected,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <Text style={styles.chipText}>{category}</Text>
                        {selectedCategories.includes(category) ? <Check color={INK} size={16} strokeWidth={3} /> : null}
                      </Pressable>
                    ))}
                  </View>
                </View>
              ) : null}

              {roomError ? <Text style={styles.errorText}>{roomError}</Text> : null}

              <View style={styles.actions}>
                <Pressable
                  disabled={isRoomBusy || Boolean(room) || leaveCooldownSeconds > 0}
                  onPress={() => {
                    gameAudio.playStart();
                    triggerHaptic('selection');
                    if (selectedMode.label === 'Practice') {
                      startPractice({
                        ...selectedMode,
                        botCount,
                        botDifficulty,
                        categories: selectedCategories,
                        matchDurationSeconds: null,
                        rounds: targetRounds,
                        roundSeconds,
                        scoringOwner,
                        scoringStyle,
                        rulesSummary: activeModeRules,
                      });
                      return;
                    }

                    createRoom(selectedMode);
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (isRoomBusy || room || leaveCooldownSeconds > 0) && styles.disabledButton,
                    pressed && !isRoomBusy && !room && leaveCooldownSeconds === 0 && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    {room
                      ? `Close session ${room.code} first`
                      : leaveCooldownSeconds > 0
                        ? `New lobby available in ${leaveCooldownSeconds}s`
                        : isRoomBusy
                          ? 'Creating...'
                          : selectedMode.label === 'Practice' ? 'Start Practice' : 'Create Private Brawl'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => {
                  gameAudio.playTap();
                  setScreen('home');
                }} style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}>
                  <Text style={styles.ghostButtonText}>Back</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {screen === 'globalLeaderboard' ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <View style={styles.screenTopBar}>
                <Pressable
                  accessibilityLabel="Back"
                  onPress={() => {
                    gameAudio.playTap();
                    setScreen('home');
                  }}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
                >
                  <ArrowLeft color={INK} size={24} strokeWidth={3} />
                </Pressable>
                <View style={styles.screenTitleBlock}>
                  <Text style={styles.eyebrow}>League table</Text>
                  <Text style={styles.heading}>Top leaders</Text>
                </View>
              </View>

              <View style={styles.leaderboardHero}>
                <View>
                  <Text style={styles.infoLabel}>Your league</Text>
                  <Text style={styles.leaderName}>{playerLeague.name}</Text>
                  <Text style={styles.leagueHeroMeta}>
                    Rank #{playerGlobalRank} - {playerProfile.allTimePoints} pts
                  </Text>
                </View>
                <View style={[styles.leagueHeroTrophy, { backgroundColor: playerLeague.color }]}>
                  <Trophy color={INK} size={38} strokeWidth={3} />
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Trophy path</Text>
                <View style={styles.leaguePath}>
                  {LEAGUES.map((league) => {
                    const isCurrentLeague = league.name === playerLeague.name;
                    const isUnlocked = playerProfile.allTimePoints >= league.minScore;

                    return (
                      <View
                        key={league.name}
                        style={[
                          styles.leagueStep,
                          isUnlocked && { backgroundColor: league.color },
                          isCurrentLeague && styles.leagueStepCurrent,
                        ]}
                      >
                        <Trophy color={INK} size={21} strokeWidth={3} />
                        <Text style={styles.leagueStepTitle}>{league.name}</Text>
                        <Text style={styles.playerMeta}>{league.minScore}+ pts</Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              <View style={styles.scoreCard}>
                <Text style={styles.infoLabel}>Next trophy</Text>
                <Text style={styles.scoreText}>{nextLeague ? nextLeague.name : 'Champion'}</Text>
                <Text style={styles.bodyText}>
                  {nextLeague
                    ? `${pointsToNextLeague} more points to reach ${nextLeague.name} League.`
                    : 'You are already in the highest league.'}
                </Text>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Top leaders</Text>
                {generalLeaderboardEntries.map((entry, index) => (
                  <View
                    key={entry.id}
                    style={[styles.generalLeaderRow, entry.id === 'you' && styles.generalLeaderRowActive]}
                  >
                    <View style={styles.settingRowMain}>
                      {entry.id === 'you' ? (
                        <View style={[styles.rankBadge, { backgroundColor: selectedAvatar.accent }]}>
                          <SelectedAvatarIcon color={INK} size={19} strokeWidth={3} />
                        </View>
                      ) : (
                        <View style={styles.rankBadge}>
                          <Text style={styles.rankBadgeText}>{index + 1}</Text>
                        </View>
                      )}
                      <View>
                        <Text style={styles.historyTitle}>{entry.name}</Text>
                        <Text style={styles.playerMeta}>{entry.meta}</Text>
                      </View>
                    </View>
                    <Text style={styles.pointsText}>{entry.score}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {screen === 'settings' ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <View style={styles.screenTopBar}>
                <Pressable
                  accessibilityLabel="Back"
                  onPress={() => {
                    gameAudio.playTap();
                    setScreen('home');
                  }}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
                >
                  <ArrowLeft color={INK} size={24} strokeWidth={3} />
                </Pressable>
                <View style={styles.screenTitleBlock}>
                  <Text style={styles.eyebrow}>Game setup</Text>
                  <Text style={styles.heading}>Settings</Text>
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Display name</Text>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={setPlayerName}
                  placeholder="Enter your name"
                  placeholderTextColor="#8A867D"
                  style={styles.input}
                  value={playerName}
                />
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Avatar</Text>
                  <View style={[styles.playerAvatarPreview, { backgroundColor: selectedAvatar.accent }]}>
                    <SelectedAvatarIcon color={INK} size={22} strokeWidth={3} />
                  </View>
                </View>
                <View style={styles.avatarPickerGrid}>
                  {PLAYER_AVATARS.map((avatar) => {
                    const AvatarIcon = avatar.icon;
                    const isSelectedAvatar = playerProfile.avatarKey === avatar.key;

                    return (
                      <Pressable
                        accessibilityLabel={`${avatar.label} avatar`}
                        key={avatar.key}
                        onPress={() => {
                          gameAudio.playTap();
                          setPlayerAvatarKey(avatar.key);
                        }}
                        style={({ pressed }) => [
                          styles.avatarOption,
                          { backgroundColor: avatar.accent },
                          isSelectedAvatar && styles.avatarOptionSelected,
                          pressed && styles.buttonPressed,
                        ]}
                      >
                        <AvatarIcon color={INK} size={24} strokeWidth={3} />
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text style={styles.sectionTitle}>Recent games</Text>
                  <Text style={styles.playerMeta}>Last {playerProfile.recentMatches.length}/5</Text>
                </View>
                {playerProfile.recentMatches.length ? (
                  playerProfile.recentMatches.map((match) => (
                    <View key={match.id} style={styles.historyRow}>
                      <View>
                        <Text style={styles.historyTitle}>{match.modeLabel}</Text>
                        <Text style={styles.playerMeta}>
                          {formatShortDate(match.playedAt)} - {formatOrdinal(match.playerRank)}/{match.totalPlayers} - {match.roundsPlayed} rounds
                        </Text>
                      </View>
                      <View style={styles.lobbyRosterScore}>
                        <Text style={styles.lobbyRosterScoreValue}>{match.playerScore}</Text>
                        <Text style={styles.lobbyRosterScoreLabel}>+{match.pointsEarned}</Text>
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.bodyText}>No finished games yet.</Text>
                )}
              </View>

              <View style={styles.settingsCard}>
                <Pressable
                  onPress={() => {
                    gameAudio.playTap();
                    setMusicOn((isOn) => !isOn);
                  }}
                  style={({ pressed }) => [styles.settingRow, pressed && styles.buttonPressed]}
                >
                  <View style={styles.settingRowMain}>
                    <Music color={INK} size={22} strokeWidth={3} />
                    <View>
                      <Text style={styles.settingRowTitle}>Music</Text>
                      <Text style={styles.settingRowMeta}>{musicOn ? `${activeModeLabel} soundtrack` : 'Off'}</Text>
                    </View>
                  </View>
                  <View style={[styles.toggleTrack, musicOn && styles.toggleTrackOn]}>
                    <View style={[styles.toggleKnob, musicOn && styles.toggleKnobOn]} />
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => {
                    gameAudio.playTap();
                    setSoundFxOn((isOn) => !isOn);
                  }}
                  style={({ pressed }) => [styles.settingRow, pressed && styles.buttonPressed]}
                >
                  <View style={styles.settingRowMain}>
                    <Volume2 color={INK} size={22} strokeWidth={3} />
                    <View>
                      <Text style={styles.settingRowTitle}>Sound FX</Text>
                      <Text style={styles.settingRowMeta}>{soundFxOn ? soundPack : 'Off'}</Text>
                    </View>
                  </View>
                  <View style={[styles.toggleTrack, soundFxOn && styles.toggleTrackOn]}>
                    <View style={[styles.toggleKnob, soundFxOn && styles.toggleKnobOn]} />
                  </View>
                </Pressable>

                <Pressable
                  onPress={() => {
                    gameAudio.playTap();
                    setHapticsOn((isOn) => {
                      const nextIsOn = !isOn;
                      if (nextIsOn) {
                        const pattern = [0, 18, 35, 28];
                        if (Platform.OS === 'web') {
                          const browserNavigator = globalThis.navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
                          browserNavigator.vibrate?.(pattern);
                        } else {
                          Vibration.vibrate(pattern);
                        }
                      }
                      return nextIsOn;
                    });
                  }}
                  style={({ pressed }) => [styles.settingRow, pressed && styles.buttonPressed]}
                >
                  <View style={styles.settingRowMain}>
                    <Zap color={INK} size={22} strokeWidth={3} />
                    <View>
                      <Text style={styles.settingRowTitle}>Haptics</Text>
                      <Text style={styles.settingRowMeta}>{hapticsOn ? 'On' : 'Off'}</Text>
                    </View>
                  </View>
                  <View style={[styles.toggleTrack, hapticsOn && styles.toggleTrackOn]}>
                    <View style={[styles.toggleKnob, hapticsOn && styles.toggleKnobOn]} />
                  </View>
                </Pressable>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Sound FX pack</Text>
                <View style={styles.optionGrid}>
                  {SOUND_PACKS.map((pack) => (
                    <Pressable
                      key={pack}
                      onPress={() => {
                        gameAudio.playTap();
                        setSoundPack(pack);
                      }}
                      style={({ pressed }) => [
                        styles.optionPill,
                        soundPack === pack && styles.optionPillSelected,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <Sparkles color={INK} size={18} strokeWidth={3} />
                      <Text style={styles.optionPillText}>{pack}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              <Pressable
                onPress={() => {
                  gameAudio.playTap();
                  setScreen('themes');
                }}
                style={({ pressed }) => [styles.navRow, pressed && styles.buttonPressed]}
              >
                <View style={styles.settingRowMain}>
                  <Palette color={INK} size={24} strokeWidth={3} />
                  <View>
                    <Text style={styles.settingRowTitle}>Themes</Text>
                    <Text style={styles.settingRowMeta}>{activeTheme.label}</Text>
                  </View>
                </View>
                <ChevronRight color={INK} size={24} strokeWidth={3} />
              </Pressable>

              <Pressable
                onPress={() => {
                  gameAudio.playTap();
                  showQuickRules();
                }}
                style={({ pressed }) => [styles.navRow, pressed && styles.buttonPressed]}
              >
                <View style={styles.settingRowMain}>
                  <BookOpen color={INK} size={24} strokeWidth={3} />
                  <View>
                    <Text style={styles.settingRowTitle}>How to Play</Text>
                    <Text style={styles.settingRowMeta}>Rules, scoring, and round flow</Text>
                  </View>
                </View>
                <ChevronRight color={INK} size={24} strokeWidth={3} />
              </Pressable>

              <Pressable
                onPress={() => {
                  gameAudio.playTap();
                  setScreen('about');
                }}
                style={({ pressed }) => [styles.navRow, pressed && styles.buttonPressed]}
              >
                <View style={styles.settingRowMain}>
                  <ShieldQuestion color={INK} size={24} strokeWidth={3} />
                  <View>
                    <Text style={styles.settingRowTitle}>About the Game</Text>
                    <Text style={styles.settingRowMeta}>What Word Brawl is built for</Text>
                  </View>
                </View>
                <ChevronRight color={INK} size={24} strokeWidth={3} />
              </Pressable>
            </View>
          ) : null}

          {screen === 'themes' ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <View style={styles.screenTopBar}>
                <Pressable
                  accessibilityLabel="Back"
                  onPress={() => {
                    gameAudio.playTap();
                    setScreen('settings');
                  }}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
                >
                  <ArrowLeft color={INK} size={24} strokeWidth={3} />
                </Pressable>
                <View style={styles.screenTitleBlock}>
                  <Text style={styles.eyebrow}>Look and feel</Text>
                  <Text style={styles.heading}>Themes</Text>
                </View>
              </View>

              <View style={styles.themeList}>
                {(Object.keys(THEMES) as ThemeKey[]).map((key) => {
                  const theme = THEMES[key];

                  return (
                    <Pressable
                      key={key}
                      onPress={() => {
                        gameAudio.playTap();
                        setThemeKey(key);
                      }}
                      style={({ pressed }) => [
                        styles.themeCard,
                        themeKey === key && styles.themeCardSelected,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <View style={styles.themePreview}>
                        {theme.lanes.map((color) => (
                          <View key={color} style={[styles.themeSwatch, { backgroundColor: color }]} />
                        ))}
                      </View>
                      <View style={styles.themeCardText}>
                        <Text style={styles.settingRowTitle}>{theme.label}</Text>
                        <Text style={styles.settingRowMeta}>
                          {themeKey === key ? 'Selected' : 'Tap to use'}
                        </Text>
                      </View>
                      {themeKey === key ? <Check color={INK} size={24} strokeWidth={3} /> : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {screen === 'about' ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <View style={styles.screenTopBar}>
                <Pressable
                  accessibilityLabel="Back"
                  onPress={() => {
                    gameAudio.playTap();
                    setScreen('settings');
                  }}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
                >
                  <ArrowLeft color={INK} size={24} strokeWidth={3} />
                </Pressable>
                <View style={styles.screenTitleBlock}>
                  <Text style={styles.eyebrow}>Word Brawl</Text>
                  <Text style={styles.heading}>About</Text>
                </View>
              </View>

              <View style={styles.aboutHero}>
                <View style={styles.brandMedal}>
                  <BrandIconMark />
                </View>
                <Text style={styles.aboutTitle}>Same letter. No mercy. Fastest fingers.</Text>
                <Text style={styles.aboutCopy}>
                  Pick a mode, race the timer, fill every category, then score answers together.
                </Text>
              </View>

              <View style={styles.madeByCard}>
                <Text style={styles.infoLabel}>Made by</Text>
                <View style={styles.madeByRow}>
                  <View style={styles.creatorBadge}>
                    <Crown color={INK} size={24} strokeWidth={3} />
                  </View>
                  <View style={styles.creatorCopy}>
                    <Text style={styles.settingRowTitle}>Mr A</Text>
                    <Text style={styles.settingRowMeta}>Game direction, taste, and build decisions.</Text>
                  </View>
                </View>
                <View style={styles.madeByRow}>
                  <View style={styles.creatorBadge}>
                    <KeyRound color={INK} size={24} strokeWidth={3} />
                  </View>
                  <View style={styles.creatorCopy}>
                    <Text style={styles.settingRowTitle}>Hikari</Text>
                    <Text style={styles.settingRowMeta}>Design, code, systems, and sharp fixes.</Text>
                  </View>
                </View>
              </View>

              <View style={styles.madeByCard}>
                <Text style={styles.infoLabel}>Version</Text>
                {[
                  ['App version', BUILD_METADATA.appVersion],
                  ['Build', BUILD_METADATA.buildIdentifier],
                  ['Build date', BUILD_METADATA.buildDate],
                  ['Environment', BUILD_METADATA.environment],
                  ['Git commit', BUILD_METADATA.gitCommit],
                ].map(([label, value]) => (
                  <View key={label} style={styles.versionInfoRow}>
                    <Text style={styles.settingRowMeta}>{label}</Text>
                    <Text selectable style={styles.versionInfoValue}>{value}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Built for</Text>
                <View style={styles.rulesList}>
                  <View style={styles.ruleRow}>
                    <Timer color={INK} size={22} strokeWidth={3} />
                    <Text style={styles.ruleText}>Quick rounds that keep the session moving.</Text>
                  </View>
                  <View style={styles.ruleRow}>
                    <Users color={INK} size={22} strokeWidth={3} />
                    <Text style={styles.ruleText}>Friends, solo practice, and CPU challenges.</Text>
                  </View>
                  <View style={styles.ruleRow}>
                    <Trophy color={INK} size={22} strokeWidth={3} />
                    <Text style={styles.ruleText}>Clean score reveals where good answers actually matter.</Text>
                  </View>
                </View>
              </View>
            </View>
          ) : null}

          {screen === 'join' ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <Text style={styles.eyebrow}>Private Brawl</Text>
              <Text style={styles.heading}>Enter session code</Text>
              <Text style={styles.bodyText}>Create a session for friends, or join one with a code.</Text>

              {room ? (
                <Pressable
                  onPress={openCurrentRoom}
                  style={({ pressed }) => [styles.openRoomCard, pressed && styles.buttonPressed]}
                >
                  <View style={styles.settingRowMain}>
                    <View style={styles.openRoomIcon}>
                      <Users color={INK} size={22} strokeWidth={3} />
                    </View>
                    <View style={styles.creatorCopy}>
                      <Text style={styles.settingRowTitle}>Session {room.code} is already open</Text>
                      <Text style={styles.settingRowMeta}>Close it before joining another session.</Text>
                    </View>
                  </View>
                  <ChevronRight color={INK} size={24} strokeWidth={3} />
                </Pressable>
              ) : null}

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Display name</Text>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={setPlayerName}
                  placeholder="Enter your name"
                  placeholderTextColor="#8A867D"
                  style={styles.input}
                  value={playerName}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Session code</Text>
                <TextInput
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={8}
                  onChangeText={setRoomCodeInput}
                  placeholder="A7KQ9Z"
                  placeholderTextColor="#8A867D"
                  style={[styles.input, styles.codeInput]}
                  value={roomCodeInput}
                />
              </View>

              {roomError ? <Text style={styles.errorText}>{roomError}</Text> : null}

              <View style={styles.actions}>
                <Pressable
                  disabled={isRoomBusy || Boolean(room)}
                  onPress={() => {
                    gameAudio.playStart();
                    setSelectedMode(GAME_MODES[0]);
                    setScreen('modeDetail');
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (isRoomBusy || Boolean(room)) && styles.disabledButton,
                    pressed && !isRoomBusy && !room && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>Create New Brawl</Text>
                </Pressable>
                <Pressable
                  disabled={!cleanedRoomCode || isRoomBusy || Boolean(room) || leaveCooldownSeconds > 0}
                  onPress={() => {
                    gameAudio.playStart();
                    triggerHaptic('selection');
                    joinRoom();
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (!cleanedRoomCode || isRoomBusy || room || leaveCooldownSeconds > 0) && styles.disabledButton,
                    pressed && cleanedRoomCode && !isRoomBusy && !room && leaveCooldownSeconds === 0 && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    {room
                      ? `Close session ${room.code} first`
                      : leaveCooldownSeconds > 0
                        ? `New lobby available in ${leaveCooldownSeconds}s`
                        : isRoomBusy ? 'Joining...' : 'Join with Code'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => {
                  gameAudio.playTap();
                  setScreen('home');
                }} style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}>
                  <Text style={styles.ghostButtonText}>Back</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {screen === 'lobby' && room ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <View style={styles.lobbyHeader}>
                <View>
                  <Text style={styles.eyebrow}>{room.visibility === 'public' ? 'Live Brawl' : 'Private Brawl'}</Text>
                  <Text style={styles.heading}>{room.visibility === 'public' ? 'Live session' : `Session ${room.code}`}</Text>
                </View>
                <View style={styles.codeBadge}>
                  <Text style={styles.codeBadgeLabel}>Expires</Text>
                  <Text style={styles.codeBadgeText}>{roomAvailabilityLabel}</Text>
                </View>
              </View>

              <View style={styles.roomDashboard}>
                <View style={styles.dashboardTopLine}>
                  <Text style={styles.dashboardLabel}>Brawl</Text>
                  <Text style={styles.dashboardStatus}>
                    {room.status === 'expired'
                      ? 'Expired'
                      : room.visibility === 'public'
                        ? 'Live match'
                        : room.isOnline ? (room.isHost ? 'You host' : 'Private brawl') : 'Local session'}
                  </Text>
                </View>
                <Text style={styles.dashboardTitle}>
                  {room.visibility === 'public' ? 'Live session is open.' : 'Private session is open.'}
                </Text>
                  <Text style={styles.dashboardCopy}>
                  {room.visibility === 'public'
                    ? `Searching for players near your ${matchmakingLeagueLabel} League level. This session fills 5 seats with real players first, then CPU rivals.`
                    : `Share the code. This session stays available for ${roomAvailabilityLabel}.`}
                </Text>

                <View style={styles.statStrip}>
                  <View style={styles.statItem}>
                    <Users color={INK} size={21} strokeWidth={3} />
                    <Text style={styles.statValue}>{room.playerCount + botCount}/{LIVE_BRAWL_TARGET_PLAYERS}</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Eye color={INK} size={21} strokeWidth={3} />
                    <Text style={styles.statValue}>{room.spectatorCount}/20</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Trophy color={INK} size={21} strokeWidth={3} />
                    <Text style={styles.statValue}>
                      {matchDurationSeconds ? formatClock(matchTimeRemaining) : `${roundHistory.length}/${targetRounds}`}
                    </Text>
                  </View>
                </View>
              </View>

              {room.visibility === 'public' ? (
                <View style={styles.section}>
                  <View style={styles.botPanel}>
                    <View style={styles.settingRowMain}>
                      <View style={styles.openRoomIcon}>
                        <Zap color={INK} size={22} strokeWidth={3} />
                      </View>
                      <View style={styles.creatorCopy}>
                        <Text style={styles.settingRowTitle}>{roomError ? 'Matchmaking paused' : isRoundBusy || liveTableCountdownRemaining === 0 ? 'Preparing your Brawl' : 'Finding real players'}</Text>
                    <Text style={styles.settingRowMeta}>
                          {roomError || 'A 0.65-second player search, then CPU rivals fill only the empty seats.'}
                        </Text>
                      </View>
                    </View>
                    {roomError ? <Pressable accessibilityRole="button" onPress={retryLiveMatch}><Text style={styles.optionPillText}>Retry</Text></Pressable> : <ActivityIndicator color={INK} size="small" />}
                    {liveTableCountdownRemaining !== null && liveTableCountdownRemaining > 0 ? (
                      <Text style={[styles.searchCountdownValue, { fontSize: 14, flexShrink: 0 }]}>0.65s</Text>
                    ) : null}
                  </View>
                </View>
              ) : null}

              {room.visibility === 'private' ? (
                <View style={styles.section}>
                  <View style={styles.inviteHeaderRow}>
                    <View style={styles.inviteHeaderCopy}>
                      <Text style={styles.sectionTitle}>Invite players</Text>
                      <Text style={styles.playerMeta}>Session code {room.code}</Text>
                    </View>
                    <Pressable
                      accessibilityLabel="Share session code"
                      onPress={shareRoomInvite}
                      style={({ pressed }) => [styles.smallActionButton, pressed && styles.buttonPressed]}
                    >
                      <Share2 color="#FFFFFF" size={17} strokeWidth={3} />
                      <Text style={styles.smallActionButtonText}>Share</Text>
                    </Pressable>
                  </View>
                  <View style={styles.rulesCard}>
                    <View style={styles.settingRowMain}>
                      <View style={styles.openRoomIcon}>
                        <KeyRound color={INK} size={22} strokeWidth={3} />
                      </View>
                      <View style={styles.creatorCopy}>
                        <Text style={styles.codeInviteText}>{room.code}</Text>
                        <Text style={styles.settingRowMeta}>Other players join from Home, then Private Brawl.</Text>
                      </View>
                    </View>
                  </View>
                </View>
              ) : null}

              {room.visibility === 'private' ? (
                <View style={styles.privateWaitingPanel}>
                  <ActivityIndicator color={INK} size="small" />
                  <View style={styles.privateWaitingCopy}>
                    <Text style={styles.privateWaitingTitle}>
                      {privatePlayersNeeded > 0
                        ? `Waiting for ${privatePlayersNeeded} more player${privatePlayersNeeded === 1 ? '' : 's'}`
                        : 'Players ready to start'}
                    </Text>
                    <Text style={styles.privateWaitingMeta}>
                      {privateHumanCount}/2 minimum players joined · {room.playerCount}/8 seats used
                    </Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Categories in this brawl</Text>
                <View style={styles.lobbyCategoryList}>
                  {selectedCategories.map((category, index) => (
                    <View key={category} style={[styles.lobbyCategoryChip, { backgroundColor: laneColor(index) }]}>
                      <Text style={styles.lobbyCategoryChipText}>{category}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <View>
                    <Text style={styles.sectionTitle}>Players in this brawl</Text>
                    <Text style={styles.playerMeta}>{room.visibility === 'public' ? room.playerCount + botCount : lobbyRosterEntries.length}/{room.visibility === 'public' ? LIVE_BRAWL_TARGET_PLAYERS : 8} seats filled</Text>
                  </View>
                </View>
                <View style={styles.lobbyRosterList}>
                  {lobbyRosterEntries.map((entry, index) => (
                    <View key={entry.id} style={styles.lobbyRosterCard}>
                      <View
                        style={[
                          styles.lobbyRosterAvatar,
                          entry.isYou && { backgroundColor: selectedAvatar.accent },
                          entry.type === 'bot' && { backgroundColor: '#FFE66D' },
                        ]}
                      >
                        {entry.isYou ? (
                          <SelectedAvatarIcon color={INK} size={24} strokeWidth={3} />
                        ) : entry.type === 'bot' ? (
                          <Bot color={INK} size={24} strokeWidth={3} />
                        ) : (
                          <Users color={INK} size={24} strokeWidth={3} />
                        )}
                      </View>
                      <View style={styles.lobbyRosterCopy}>
                        <View style={styles.lobbyRosterNameRow}>
                          <Text style={styles.lobbyRosterName}>{entry.name}{entry.isYou ? ' (you)' : ''}</Text>
                          {entry.isPending ? (
                            <Text style={styles.lobbyRosterBadge}>Joining</Text>
                          ) : entry.isHost && room.visibility !== 'public' ? (
                            <Text style={styles.lobbyRosterBadge}>Host</Text>
                          ) : null}
                        </View>
                        <Text style={styles.lobbyRosterMeta}>
                          {entry.meta} - Seat {index + 1}
                        </Text>
                      </View>
                      <View style={styles.lobbyRosterScore}>
                        <Text style={styles.lobbyRosterScoreValue}>{entry.score}</Text>
                        <Text style={styles.lobbyRosterScoreLabel}>Pts</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              <Pressable
                onPress={() => {
                  gameAudio.playTap();
                  setShowLobbySettings((current) => !current);
                }}
                style={({ pressed }) => [styles.lobbySettingsToggle, pressed && styles.buttonPressed]}
              >
                <View style={styles.settingRowMain}>
                  <View style={styles.openRoomIcon}>
                    <SlidersHorizontal color={INK} size={22} strokeWidth={3} />
                  </View>
                  <View style={styles.creatorCopy}>
                    <Text style={styles.settingRowTitle}>Settings</Text>
                    <Text style={styles.settingRowMeta}>
                      {selectedCategories.length} categories - {roundSeconds}s - {scoringStyle}
                    </Text>
                  </View>
                </View>
                <Text style={styles.smallToggleText}>{showLobbySettings ? 'Hide' : 'Show'}</Text>
              </Pressable>

              {canManageBrawl && !isEditingBrawl ? (
                <Pressable accessibilityRole="button" onPress={() => { beginEditBrawl(); setShowLobbySettings(true); }} style={styles.optionPill}>
                  <Text style={styles.optionPillText}>Edit Brawl</Text>
                </Pressable>
              ) : null}
              {isEditingBrawl ? (
                <View style={styles.section}>
                  <Text style={styles.helperText}>Editing this Brawl. Changes are applied only when you save.</Text>
                  <Text style={styles.label}>Brawl name</Text>
                  <TextInput accessibilityLabel="Brawl name" value={activeModeLabel} onChangeText={setBrawlLabel} maxLength={80} editable={!isSavingBrawl} style={styles.input} />
                  <Text style={styles.label}>Instructions / description</Text>
                  <TextInput accessibilityLabel="Brawl description" value={activeModeRules} onChangeText={setBrawlRules} maxLength={500} multiline editable={!isSavingBrawl} style={styles.input} />
                  <View style={styles.optionGrid}>
                    <Pressable accessibilityRole="button" disabled={isSavingBrawl} onPress={saveEditBrawl} style={styles.optionPill}>
                      <Text style={styles.optionPillText}>{isSavingBrawl ? 'Saving...' : 'Save Brawl'}</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" disabled={isSavingBrawl} onPress={cancelEditBrawl} style={styles.optionPill}>
                      <Text style={styles.optionPillText}>Cancel changes</Text>
                    </Pressable>
                  </View>
                  {roomError ? <Text style={styles.errorText}>{roomError}</Text> : null}
                </View>
              ) : null}
              {showLobbySettings ? (
                <View style={styles.lobbySettingsPanel}>
              <View style={styles.infoGrid}>
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>{room.visibility === 'public' ? 'Session' : 'Host'}</Text>
                  <Text style={styles.infoValue}>
                    {room.visibility === 'public' ? 'Live Brawl' : `${room.hostName}${room.isHost ? ' (you)' : ''}`}
                  </Text>
                </View>
                <View style={styles.infoBox}>
                  <Text style={styles.infoLabel}>Timer</Text>
                  <Text style={styles.infoValue}>{roundSeconds}s</Text>
                </View>
              </View>

              <View style={styles.rulesCard}>
                <View style={styles.settingRowMain}>
                  <SlidersHorizontal color={INK} size={23} strokeWidth={3} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.settingRowTitle}>{activeModeLabel}</Text>
                    <Text style={styles.settingRowMeta}>{activeModeRules}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.setupSummaryCard}>
                <View style={[styles.dashboardTopLine, { flexWrap: 'wrap', gap: 8 }]}>
                  <Text style={styles.dashboardLabel}>Match setup</Text>
                  <Text style={styles.dashboardStatus}>{activeModeLabel}</Text>
                </View>
                <View style={styles.setupSummaryGrid}>
                  <View style={styles.setupSummaryItem}>
                    <Trophy color={INK} size={19} strokeWidth={3} />
                    <Text style={styles.setupSummaryValue}>
                      {matchDurationSeconds ? formatClock(matchDurationSeconds) : `${targetRounds} rounds`}
                    </Text>
                  </View>
                  <View style={styles.setupSummaryItem}>
                    <Timer color={INK} size={19} strokeWidth={3} />
                    <Text style={styles.setupSummaryValue}>{roundSeconds}s</Text>
                  </View>
                  <View style={styles.setupSummaryItem}>
                    {room.visibility === 'public' ? (
                      <Users color={INK} size={19} strokeWidth={3} />
                    ) : (
                      <Bot color={INK} size={19} strokeWidth={3} />
                    )}
                    <Text style={styles.setupSummaryValue}>
                      {room.visibility === 'public' ? `${room.playerCount + botCount}/${LIVE_BRAWL_TARGET_PLAYERS} seats` : `${botCount} CPUs`}
                    </Text>
                  </View>
                  <View style={styles.setupSummaryItem}>
                    <ShieldQuestion color={INK} size={19} strokeWidth={3} />
                    <Text style={styles.setupSummaryValue}>{scoringOwner}</Text>
                  </View>
                </View>
                <Text style={styles.setupSummaryMeta}>
                  {selectedCategories.length} categories - {scoringStyle} scoring
                </Text>
                <Text style={styles.settingRowMeta}>
                  {room.visibility === 'public'
                    ? 'Live Brawl setup is locked for fair matchmaking.'
                    : canManageBrawl
                    ? 'Use Edit Brawl to change setup before the first round.'
                    : room.isHost
                      ? 'Setup locked for this game.'
                      : `${room.hostName} controls setup before the first round.`}
                </Text>
              </View>

              {roundHistory.length ? (
                <View style={styles.scoreCard}>
                  <Text style={styles.infoLabel}>Current total</Text>
                  <Text style={styles.scoreText}>{lifetimeScore} points</Text>
                </View>
              ) : null}

              {roomError ? <Text style={styles.errorText}>{roomError}</Text> : null}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Next letter</Text>
                {renderLetterPickerCard()}
              </View>

              {room.visibility !== 'public' ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>CPUs</Text>
                  <View style={styles.botPanel}>
                    <View style={styles.settingRowMain}>
                      <Bot color={INK} size={24} strokeWidth={3} />
                      <View>
                        <Text style={styles.settingRowTitle}>CPU rivals</Text>
                        <Text style={styles.settingRowMeta}>
                          {botCount ? `${botCount} active` : 'None'}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.stepper}>
                      <Pressable
                        accessibilityLabel="Remove CPU"
                        disabled={!canEditRoomSetup}
                        onPress={() => {
                          gameAudio.playTap();
                          setBotCount(botCount - 1);
                        }}
                        style={({ pressed }) => [styles.stepperButton, !canEditRoomSetup && styles.disabledButton, pressed && canEditRoomSetup && styles.buttonPressed]}
                      >
                        <Minus color={INK} size={18} strokeWidth={3} />
                      </Pressable>
                      <Text style={styles.stepperValue}>{botCount}</Text>
                      <Pressable
                        accessibilityLabel="Add CPU"
                        disabled={!canEditRoomSetup}
                        onPress={() => {
                          gameAudio.playTap();
                          setBotCount(botCount + 1);
                        }}
                        style={({ pressed }) => [styles.stepperButton, !canEditRoomSetup && styles.disabledButton, pressed && canEditRoomSetup && styles.buttonPressed]}
                      >
                        <Plus color={INK} size={18} strokeWidth={3} />
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.optionGrid}>
                    {(['Easy', 'Normal', 'Hard'] as const).map((difficulty) => (
                      <Pressable
                        disabled={!canEditRoomSetup}
                        key={difficulty}
                        onPress={() => {
                          gameAudio.playTap();
                          setBotDifficulty(difficulty);
                        }}
                        style={({ pressed }) => [
                          styles.optionPill,
                          botDifficulty === difficulty && styles.optionPillSelected,
                          !canEditRoomSetup && styles.disabledButton,
                          pressed && canEditRoomSetup && styles.buttonPressed,
                        ]}
                      >
                        <Bot color={INK} size={18} strokeWidth={3} />
                        <Text style={styles.optionPillText}>{difficulty}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {botPlayers.length ? (
                    <View style={styles.noticeStack}>
                      {botPlayers.map((botPlayer) => (
                        <View key={botPlayer.id} style={styles.noticeStackCard}>
                          <View style={styles.dashboardTopLine}>
                            <Text style={styles.settingRowTitle}>{botPlayer.name}</Text>
                            <Text style={styles.dashboardStatus}>{botPlayer.personality}</Text>
                          </View>
                          <Text style={styles.settingRowMeta}>{botPlayer.personality} CPU</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                  <Text style={styles.helperText}>{BOT_LIBRARY_LABEL}</Text>
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{matchDurationSeconds ? 'Marathon clock' : 'Rounds'}</Text>
                <View style={styles.botPanel}>
                  <View style={styles.settingRowMain}>
                    {matchDurationSeconds ? (
                      <Timer color={INK} size={24} strokeWidth={3} />
                    ) : (
                      <Trophy color={INK} size={24} strokeWidth={3} />
                    )}
                    <View>
                      <Text style={styles.settingRowTitle}>
                        {matchDurationSeconds ? 'Fixed time' : 'Match length'}
                      </Text>
                      <Text style={styles.settingRowMeta}>
                        {matchDurationSeconds ? `${formatClock(matchTimeRemaining)} remaining` : `${targetRounds} rounds`}
                      </Text>
                    </View>
                  </View>
                  {matchDurationSeconds ? (
                    <Text style={styles.stepperValue}>{formatClock(matchDurationSeconds)}</Text>
                  ) : (
                  <View style={styles.stepper}>
                    <Pressable
                      accessibilityLabel="Fewer rounds"
                      disabled={!canEditRoomSetup}
                      onPress={() => {
                        gameAudio.playTap();
                        setTargetRounds(targetRounds - 1);
                      }}
                      style={({ pressed }) => [styles.stepperButton, !canEditRoomSetup && styles.disabledButton, pressed && canEditRoomSetup && styles.buttonPressed]}
                    >
                      <Minus color={INK} size={18} strokeWidth={3} />
                    </Pressable>
                    <Text style={styles.stepperValue}>{targetRounds}</Text>
                    <Pressable
                      accessibilityLabel="More rounds"
                      disabled={!canEditRoomSetup}
                      onPress={() => {
                        gameAudio.playTap();
                        setTargetRounds(targetRounds + 1);
                      }}
                      style={({ pressed }) => [styles.stepperButton, !canEditRoomSetup && styles.disabledButton, pressed && canEditRoomSetup && styles.buttonPressed]}
                    >
                      <Plus color={INK} size={18} strokeWidth={3} />
                    </Pressable>
                  </View>
                  )}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Rules</Text>
                <View style={styles.botPanel}>
                  <View style={styles.settingRowMain}>
                    <Clock3 color={INK} size={24} strokeWidth={3} />
                    <View>
                      <Text style={styles.settingRowTitle}>Timer</Text>
                      <Text style={styles.settingRowMeta}>{roundSeconds} seconds</Text>
                    </View>
                  </View>
                  <View style={styles.stepper}>
                    <Pressable
                      accessibilityLabel="Shorter timer"
                      disabled={!canEditRoomSetup}
                      onPress={() => {
                        gameAudio.playTap();
                        setRoundSeconds(roundSeconds - 15);
                      }}
                      style={({ pressed }) => [styles.stepperButton, !canEditRoomSetup && styles.disabledButton, pressed && canEditRoomSetup && styles.buttonPressed]}
                    >
                      <Minus color={INK} size={18} strokeWidth={3} />
                    </Pressable>
                    <Text style={styles.stepperValue}>{roundSeconds}</Text>
                    <Pressable
                      accessibilityLabel="Longer timer"
                      disabled={!canEditRoomSetup}
                      onPress={() => {
                        gameAudio.playTap();
                        setRoundSeconds(roundSeconds + 15);
                      }}
                      style={({ pressed }) => [styles.stepperButton, !canEditRoomSetup && styles.disabledButton, pressed && canEditRoomSetup && styles.buttonPressed]}
                    >
                      <Plus color={INK} size={18} strokeWidth={3} />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.optionGrid}>
                  {(['Classic', 'Strict'] as const).map((style) => (
                    <Pressable
                      disabled={!canEditRoomSetup}
                      key={style}
                      onPress={() => {
                        gameAudio.playTap();
                        setModeScoringStyle(style);
                      }}
                      style={({ pressed }) => [
                        styles.optionPill,
                        scoringStyle === style && styles.optionPillSelected,
                        !canEditRoomSetup && styles.disabledButton,
                        pressed && canEditRoomSetup && styles.buttonPressed,
                      ]}
                    >
                      <Check color={INK} size={18} strokeWidth={3} />
                      <Text style={styles.optionPillText}>{style}</Text>
                    </Pressable>
                  ))}
                </View>

                <View style={styles.optionGrid}>
                  {(['Opponents', 'Self'] as const).map((owner) => {
                    const isSelectedScoringOwner = scoringOwner === owner;

                    return (
                      <Pressable
                        disabled={!canEditRoomSetup}
                        key={owner}
                        onPress={() => {
                          gameAudio.playTap();
                          setScoringOwner(owner);
                        }}
                        style={({ pressed }) => [
                          styles.optionPill,
                          styles.scorerOptionPill,
                          isSelectedScoringOwner && styles.scorerOptionPillSelected,
                          !canEditRoomSetup && styles.disabledButton,
                          pressed && canEditRoomSetup && styles.buttonPressed,
                        ]}
                      >
                        <ShieldQuestion
                          color={isSelectedScoringOwner ? '#FFFFFF' : INK}
                          size={18}
                          strokeWidth={3}
                        />
                        <Text
                          style={[
                            styles.optionPillText,
                            styles.scorerOptionPillText,
                            isSelectedScoringOwner && styles.scorerOptionPillTextSelected,
                          ]}
                        >
                          {owner === 'Opponents' ? 'Opponent scoring' : 'Self scoring'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Round categories</Text>
                <View style={styles.chipGrid}>
                  {STARTER_CATEGORIES.map((category, index) => (
                    <Pressable
                      disabled={!canEditRoomSetup}
                      key={category}
                      onPress={() => {
                        gameAudio.playTap();
                        toggleSelectedCategory(category);
                      }}
                      style={({ pressed }) => [
                        styles.chip,
                        { backgroundColor: selectedCategories.includes(category) ? laneColor(index) : '#FFFFFF' },
                        !selectedCategories.includes(category) && styles.chipUnselected,
                        !canEditRoomSetup && styles.disabledButton,
                        pressed && canEditRoomSetup && styles.buttonPressed,
                      ]}
                    >
                      <Text style={styles.chipText}>{category}</Text>
                      {selectedCategories.includes(category) ? (
                        <Check color={INK} size={16} strokeWidth={3} />
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              </View>
                </View>
              ) : null}

	              <View style={styles.actions}>
	                <Pressable
	                  disabled={isEditingBrawl || isLiveTableLobby || isRoundBusy || isMatchComplete || isOnlineNonPicker || needsPickedLetter}
	                  onPress={() => {
	                    gameAudio.playStart();
                    triggerHaptic('success');
                    startRound();
	                  }}
	                  style={({ pressed }) => [
	                    styles.primaryButton,
	                    (isLiveTableLobby || isRoundBusy || isMatchComplete || isOnlineNonPicker || needsPickedLetter) && styles.disabledButton,
	                    pressed && !isLiveTableLobby && !isRoundBusy && !isMatchComplete && !isOnlineNonPicker && !needsPickedLetter && styles.buttonPressed,
	                  ]}
	                >
	                  <Text style={styles.primaryButtonText}>
	                    {isLiveTableLobby
                        ? `Searching ${liveTableCountdownRemaining ?? ''}s`
                        : isOnlineNonPicker
	                      ? `Waiting for ${room.letterPickerName ?? room.hostName}`
	                      : isMatchComplete
	                        ? 'Match Complete'
                        : needsPickedLetter
                          ? 'Pick a Letter'
                          : isRoundBusy ? 'Starting...' : 'Start Round'}
                  </Text>
                </Pressable>
                {roundHistory.length ? (
                  <Pressable onPress={() => {
                    gameAudio.playTap();
                    setScreen('leaderboard');
                  }} style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}>
                    <Text style={styles.secondaryButtonText}>View Leaderboard</Text>
                  </Pressable>
                ) : null}
                <Pressable onPress={() => {
                  gameAudio.playTap();
                  requestLeaveRoom();
                }} style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}>
                  <Text style={styles.ghostButtonText}>Close Session</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {screen === 'round' && room ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <View style={styles.roundBoard}>
                <View style={styles.boardHeader}>
                  <View style={styles.boardHeaderCopy}>
                    <Text style={styles.boardKicker}>Round {roundHistory.length + 1}</Text>
                    <Text style={styles.boardTitle}>Answer fast</Text>
                  </View>
                </View>

                <View style={styles.boardLetterPanel}>
                  <View style={styles.boardLetterTile}>
                    <Text style={styles.boardLetterText}>{roundLetter}</Text>
                  </View>
                  <View style={styles.boardLetterCopy}>
                    <Text style={styles.boardProgressTitle}>{answeredCount}/{selectedCategories.length} answered</Text>
                    <View style={styles.boardProgressTrack}>
                      <View
                        style={[
                          styles.boardProgressFill,
                          { width: `${selectedCategories.length ? (answeredCount / selectedCategories.length) * 100 : 0}%` },
                        ]}
                      />
                    </View>
                    <Text style={styles.boardLetterHint}>
                      {currentRoundPickerName ? `${currentRoundPickerName} picked ${roundLetter}. ` : ''}
                      Every answer starts with {roundLetter}.
                    </Text>
                  </View>
                </View>

                <View style={styles.boardCategoryHeader}>
                  <Text style={styles.boardSectionTitle}>Your words</Text>
                  <Text style={styles.boardSectionMeta}>Same letter. No mercy.</Text>
                </View>

                <ScrollView
                  nestedScrollEnabled
                  showsVerticalScrollIndicator={false}
                  style={styles.boardAnswerScroller}
                  contentContainerStyle={styles.boardAnswerStack}
                >
                  {selectedCategories.map((category, index) => (
                    <View
                      key={category}
                      style={[styles.boardAnswerCard, { backgroundColor: laneColor(index) }]}
                    >
                      <View style={styles.boardAnswerTopLine}>
                        <View style={styles.boardCategoryPill}>
                          <Text style={styles.boardCategoryText}>{category}</Text>
                        </View>
                        <Text style={styles.answerIndex}>{index + 1}/{selectedCategories.length}</Text>
                      </View>
                      <TextInput
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect={false}
                        editable={!roundSubmitted}
                        importantForAutofill="no"
                        onChangeText={(value) => updateAnswer(category, value)}
                        placeholder={`${category} starting with ${roundLetter}`}
                        placeholderTextColor="#777166"
                        spellCheck={false}
                        style={[styles.input, styles.boardInput]}
                        value={answers[category]}
                      />
                    </View>
                  ))}
                </ScrollView>
              </View>

              {roundSubmitted ? (
                <View style={styles.submittedCard}>
                  <Text style={styles.sectionTitle}>
                    Answers saved {room.isOnline ? 'online' : 'locally'}
                  </Text>
                  <Text style={styles.bodyText}>{answeredCount}/{selectedCategories.length} locked. Reveal next.</Text>
                </View>
              ) : null}

              {roomError ? <Text style={styles.errorText}>{roomError}</Text> : null}

              <View style={[
                styles.actions,
                Platform.OS === 'web' && styles.roundActions,
                isCompactWeb && styles.roundActionsCompact,
              ]}>
                <Pressable
                  disabled={roundSubmitted || isRoundBusy}
                  onPress={() => {
                    gameAudio.playSubmit();
                    triggerHaptic('success');
                    void submitAnswers();
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    Platform.OS === 'web' && styles.roundSubmitButton,
                    (roundSubmitted || isRoundBusy) && styles.disabledButton,
                    pressed && !roundSubmitted && !isRoundBusy && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    {isRoundBusy ? 'Saving...' : roundSubmitted ? 'Submitted' : 'Submit Answers'}
                  </Text>
                </Pressable>
                <Pressable onPress={() => {
                  gameAudio.playTap();
                  requestLeaveRoom();
                }} style={({ pressed }) => [
                  styles.ghostButton,
                  Platform.OS === 'web' && styles.roundQuitButton,
                  pressed && styles.buttonPressed,
                ]}>
                  <Text style={styles.ghostButtonText}>Quit Game</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {screen === 'reveal' && room ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <View style={styles.roundHeader}>
                <View style={styles.screenTopBarCompact}>
                  <Pressable
	                    accessibilityLabel="Back"
	                    onPress={() => {
	                      gameAudio.playTap();
	                      setScreen('lobby');
	                    }}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
                  >
                    <ArrowLeft color={INK} size={24} strokeWidth={3} />
                  </Pressable>
                  <View>
                    <Text style={styles.eyebrow}>Words locked</Text>
                    <Text style={styles.heading}>Letter {roundLetter}</Text>
                  </View>
                </View>
              </View>

              <View style={styles.roomDashboard}>
                <View style={styles.dashboardTopLine}>
                  <Text style={styles.dashboardLabel}>Round submitted</Text>
                  <Text style={styles.dashboardStatus}>
                    {currentRound ? `Round ${currentRound.roundNumber}` : 'Ready'}
                  </Text>
                </View>
                <Text style={styles.dashboardTitle}>Words are locked.</Text>
                <Text style={styles.dashboardCopy}>
                  Everyone's answers are in. Score fast, challenge bad calls, then get back to the brawl.
                </Text>
                <View style={styles.statStrip}>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{answeredCount}</Text>
                    <Text style={styles.statLabel}>Answered</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{selectedCategories.length}</Text>
                    <Text style={styles.statLabel}>Categories</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{scoringOwner === 'Opponents' ? 'Them' : 'You'}</Text>
                    <Text style={styles.statLabel}>Scores</Text>
                  </View>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Your answers</Text>
                {selectedCategories.map((category, index) => (
                  <View key={category} style={[styles.revealRow, { backgroundColor: laneColor(index) }]}>
                    <View style={styles.revealTopLine}>
                      <View>
                        <Text style={styles.label}>{category}</Text>
                        <Text style={answers[category].trim() ? styles.answerText : styles.emptyAnswerText}>
                          {answers[category].trim() || 'No answer'}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.actions}>
                <Pressable
                  disabled={!hasEveryOnlinePlayerSubmitted}
                  onPress={() => {
                    gameAudio.playStart();
                    setScoringStep('score');
                    setScoringCardIndex(0);
                    setShowScoringHelp(!hideScoringHelpPermanently);
                    setScreen('scoring');
                  }}
                  style={({ pressed }) => [
                    styles.primaryButton,
                    !hasEveryOnlinePlayerSubmitted && styles.disabledButton,
                    pressed && hasEveryOnlinePlayerSubmitted && styles.buttonPressed,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>
                    {!hasEveryOnlinePlayerSubmitted
                      ? pendingSubmitterLabel
                        ? `Waiting for ${pendingSubmitterLabel}`
                        : 'Waiting for Players'
                      : 'Score the Round'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {screen === 'scoring' && room ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel, Platform.OS === 'web' && styles.webScoringPanel]}>
              <View style={styles.roundHeader}>
                <View style={styles.screenTopBarCompact}>
                  <Pressable
                    accessibilityLabel="Back"
                    onPress={() => {
                      gameAudio.playTap();
                      setScreen('lobby');
                    }}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
                  >
                    <ArrowLeft color={INK} size={24} strokeWidth={3} />
                  </Pressable>
                  <View>
                    <Text style={styles.eyebrow}>Score the round</Text>
                    <Text style={styles.heading}>Letter {roundLetter}</Text>
                    <Text style={styles.roundProgressText}>
                      Round {currentRound?.roundNumber ?? roundHistory.length + 1} of {targetRounds} · {Math.max(0, targetRounds - (currentRound?.roundNumber ?? roundHistory.length + 1))} after this
                    </Text>
                  </View>
                </View>
                <View style={styles.scorePill}>
                  <Text style={styles.scorePillLabel}>Score</Text>
                  <Text style={styles.scorePillText}>{totalScore}</Text>
                </View>
              </View>

              {scoringStep === 'score' && activeScoreCard ? (
                <View style={styles.markingFirstBlock}>
                  {renderScoringSwipeDeck()}
                </View>
              ) : null}

              {scoringStep === 'review' || (scoringStep === 'score' && activeScoreCard) ? null : (
              <View style={styles.roomDashboard}>
                <View style={styles.dashboardTopLine}>
                  <Text style={styles.dashboardLabel}>Battle calls</Text>
                  <Text style={styles.dashboardStatus}>
                    {currentRound ? `Round ${currentRound.roundNumber}` : 'Player vote'}
                  </Text>
                </View>
                <Text style={styles.dashboardTitle}>
                  {room.isOnline && !humanScoringWork.required.length ? 'No manual scores required' : scoringOwner === 'Opponents' ? 'Judge their words' : 'Call your words'}
                </Text>
                <Text style={styles.dashboardCopy}>
                  {room.isOnline && scoringStep === 'score'
                    ? humanScoringWork.required.length ? 'Score every nonempty opponent answer. Recorded votes determine progress.' : 'Automatic scoring needs no manual CPU votes. Review the answers; Finish waits for server readiness.'
                    : scoringStep === 'score'
                    ? scoringOwner === 'Opponents'
                      ? activeScoringTargetName
                        ? `Your target: ${activeScoringTargetName}. Make quick calls and keep the match moving.`
                        : 'Your scoring target will appear here once answers are ready.'
                      : 'Score your own answers first. You can still see the other answers for context.'
                    : scoringOwner === 'Opponents'
                      ? 'Review the calls on your words. Challenge anything that looks wrong before the next round.'
                      : 'Review the table calls. Challenge anything that looks wrong before the next round.'}
                </Text>

                <View style={styles.statStrip}>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>10</Text>
                    <Text style={styles.statLabel}>Valid</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>5</Text>
                    <Text style={styles.statLabel}>Shared</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>0</Text>
                    <Text style={styles.statLabel}>Invalid</Text>
                  </View>
                </View>
              </View>
              )}

              <View style={styles.optionGrid}>
                {([
                  { key: 'score', label: '1. Score Answers' },
                  { key: 'review', label: '2. Review' },
                ] as const).map((step) => (
                  <Pressable
                    key={step.key}
                    disabled={step.key === 'review' && !scoringPolicy.canReview}
                    onPress={() => {
                      if (step.key === 'review') { scoringNavigation.review(); return; }
                      gameAudio.playTap();
                      setScoringStep(step.key);
                    }}
                    style={({ pressed }) => [
                      styles.optionPill,
                      scoringStep === step.key && styles.optionPillSelected,
                      step.key === 'review' && !scoringPolicy.canReview && styles.disabledButton,
                      pressed && (step.key !== 'review' || scoringPolicy.canReview) && styles.buttonPressed,
                    ]}
                  >
                    <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                    <Text style={styles.optionPillText}>{step.label}</Text>
                  </Pressable>
                ))}
              </View>

              {scoringStep === 'review' ? renderCompactReview() : null}

              {shouldRenderLegacyScoring ? (
              <View>
              {room.isOnline ? (
                <View
                  accessibilityRole="timer"
                  accessibilityLabel={`Online ${onlineTimeoutPhase} readiness ${phasePresentation.label}`}
                  style={[
                    styles.phaseDeadlineCard,
                    onlineCountdownState.status === 'expired' && styles.phaseDeadlineCardExpired,
                    onlineCountdownState.status === 'complete' && styles.phaseDeadlineCardComplete,
                    onlineCountdownState.status === 'error' && styles.phaseDeadlineCardError,
                  ]}
                >
                  <View style={styles.dashboardTopLine}>
                    <Text style={styles.dashboardLabel}>
                      {onlineTimeoutPhase === 'dispute'
                        ? 'Dispute deadline'
                        : onlineTimeoutPhase === 'scoring'
                          ? 'Scoring deadline'
                          : 'Server deadline'}
                    </Text>
                    <Text style={styles.phaseDeadlineValue}>{phasePresentation.label}</Text>
                  </View>
                  <Text style={styles.settingRowMeta}>
                    {phasePresentation.detail}
                  </Text>
                </View>
              ) : null}

              {room.isOnline && !(scoringStep === 'score' && activeScoreCard) ? (
                <View style={styles.disputeSummaryCard}>
                  <View style={styles.dashboardTopLine}>
                    <Text style={styles.dashboardLabel}>Session agreement</Text>
                    <Text style={styles.dashboardStatus}>
                      {onlineRoundAgreement.isRoundReady ? 'Ready' : 'Waiting'}
                    </Text>
                  </View>
                <View style={styles.statStrip}>
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>
                        {onlineRoundAgreement.submittedPlayerCount}/{onlineRoundAgreement.activePlayerCount || room.playerCount}
                      </Text>
                      <Text style={styles.statLabel}>Submitted</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>
                        {onlineRoundAgreement.voteCount}/{onlineRoundAgreement.expectedVoteCount}
                      </Text>
                      <Text style={styles.statLabel}>Votes</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statItem}>
                      <Text style={styles.statValue}>{onlineRoundAgreement.isRoundReady ? 'Yes' : 'No'}</Text>
                      <Text style={styles.statLabel}>Ready</Text>
                    </View>
                  </View>
                  <Text style={styles.helperText}>
                    {onlineRoundAgreement.isRoundReady
                      ? 'Everyone active has submitted and voting is complete.'
                      : pendingSubmitterLabel
                        ? `Waiting for ${pendingSubmitterLabel} to submit.`
                        : pendingVoterLabel
                          ? `Waiting for ${pendingVoterLabel} to vote.`
                          : pendingDisputeVoterLabel
                            ? `Waiting for ${pendingDisputeVoterLabel} to resolve disputes.`
                          : 'Finish unlocks when active players submit and expected votes are in.'}
                  </Text>
                </View>
              ) : null}

              {scoringStep === 'score' && activeScoreCard ? null : (
              <View style={styles.scoringProgressCard}>
                <View style={styles.dashboardTopLine}>
                  <Text style={styles.dashboardLabel}>
                    {scoringStep === 'score' ? 'Judge phase' : 'Challenge phase'}
                  </Text>
                  <Text style={styles.dashboardStatus}>
                    {scoringTaskTotal ? `${scoringTaskDone}/${scoringTaskTotal}` : 'Auto'}
                  </Text>
                </View>
                <Text style={styles.settingRowTitle}>
                  {scoringStep === 'score'
                    ? activeScoringTargetName
                      ? `Score ${activeScoringTargetName}`
                      : liveBrawlSystemScoresBots
                        ? 'CPU rivals scored by the server'
                        : 'No manual scores needed'
                    : hasUnresolvedDisputes
                      ? 'Resolve open disputes'
                      : 'Review the final calls'}
                </Text>
                <Text style={styles.settingRowMeta}>
                  {scoringStep === 'score'
                    ? activeScoringTargetName
                      ? room.isOnline ? 'Score every required opponent answer, then review anything that looks wrong.' : 'Score the assigned player only, then review anything that looks wrong.'
                      : liveBrawlSystemScoresBots
                        ? 'Live Brawl CPU answers and scores are shared by every player. You can check their meanings; human answers can still be challenged.'
                        : 'No assigned target this round. Move straight to review.'
                    : 'Challenge only the scores that look wrong before the leaderboard.'}
                </Text>
                <View style={styles.scoringProgressTrack}>
                  <View style={[styles.scoringProgressFill, { width: `${Math.round(scoringTaskProgress * 100)}%` }]} />
                </View>
              </View>
              )}

              {scoringStep === 'score' && activeScoreCard ? null : (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  {scoringStep === 'score'
                    ? scoringOwner === 'Self'
                      ? 'Your answers'
                      : room.isOnline
                        ? activeScoringTarget === 'bots'
                          ? liveBrawlSystemScoresBots ? 'Brawler to score' : 'Bots you must score'
                          : activeScoringTarget === 'players'
                            ? 'Player to score'
                            : 'Ready for review'
                        : 'Bots you must score'
                    : 'Scores to review'}
                </Text>
                <Text style={styles.sectionIntroText}>
                  {scoringStep === 'score'
                    ? scoringOwner === 'Self'
                      ? 'Score your own submitted words. CPU scores itself automatically.'
                      : room.isOnline
                        ? activeScoringTarget === 'bots'
                          ? liveBrawlSystemScoresBots ? 'This session assigned you one brawler to score this round.' : 'This mixed session assigned you to score bot answers this round.'
                          : activeScoringTarget === 'players'
                            ? 'This session assigned you to score one real player this round.'
                            : 'CPU results are ready. Review the shared scores and check uncertain words.'
                        : 'Opponent scoring against bots means you score the bot answers.'
                    : 'Challenge only the scores that look wrong. Fact check is evidence for final verdicts.'}
                </Text>
                {scoringStep === 'score' && scoringOwner === 'Opponents' && activeScoringTargetName ? (
                  <View style={styles.targetFocusCard}>
                    <Text style={styles.dashboardLabel}>Scoring target</Text>
                    <Text style={styles.settingRowTitle}>{activeScoringTargetName}</Text>
                    <Text style={styles.settingRowMeta}>
                      Score only this {activeScoringTarget === 'bots' && !liveBrawlSystemScoresBots ? 'CPU' : 'player'} this round. Their answers are shown first in each category.
                    </Text>
                  </View>
                ) : null}
                {scoringStep === 'review' && reviewCategoryDeck.length ? (
                  <View style={styles.reviewStackWrap}>
                    <View style={styles.dashboardTopLine}>
                      <Text style={styles.dashboardLabel}>Review categories</Text>
                      <Text style={styles.dashboardStatus}>Swipe</Text>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      snapToInterval={314}
                      decelerationRate="fast"
                      contentContainerStyle={styles.reviewStackTrack}
                    >
                      {reviewCategoryDeck.map((deckCard, index) => (
                        <View
                          key={deckCard.category}
                          style={[
                            styles.reviewStackCard,
                            { backgroundColor: deckCard.color },
                          ]}
                        >
                          <View style={styles.dashboardTopLine}>
                            <Text style={styles.scoreSideCategory}>{deckCard.category}</Text>
                            <Text style={styles.scoreSideVerdict}>
                              {deckCard.duplicateCount ? `${deckCard.duplicateCount} match` : `${deckCard.entries.length} answer${deckCard.entries.length === 1 ? '' : 's'}`}
                            </Text>
                          </View>
                          <View style={styles.reviewAnswerStack}>
                            {deckCard.entries.map((entry) => (
                              <View
                                key={entry.id}
                                style={[
                                  styles.reviewAnswerRow,
                                  getScoreToneStyle(entry.verdict),
                                  entry.isDuplicate && styles.scoreCompareRowMatch,
                                  entry.isDisputed && styles.disputedAnswerRow,
                                ]}
                              >
                                <View style={styles.reviewAnswerNameBlock}>
                                  <Text style={styles.scoreSideName} numberOfLines={1}>{entry.label}</Text>
                                  <Text style={styles.scoreSideVerdict}>{formatDisputeVote(entry.verdict as DisputeVote)}</Text>
                                </View>
                                <Text style={styles.reviewAnswerText} numberOfLines={2}>{entry.answer}</Text>
                                <Text style={styles.reviewAnswerPoints}>{entry.points}</Text>
                              </View>
                            ))}
                          </View>
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                ) : null}
                {scoringStep === 'score' && activeScoreCard ? null : selectedCategories.map((category, index) => {
                  const answer = answers[category].trim();
                  const isBlank = !answer;
	                  const isDisputed = disputedCategories.includes(category);
	                  const isBotDisputed = botDisputedCategories.includes(category);
	                  const categoryVote = categoryVotes[category];
                  const categoryPlayerVote = categoryPlayerVotes[category];
                  const categoryBotVotes = categoryBotVoteLists[category] ?? [];
                  const botSuggestedVote = botCategoryVotes[category];
                  const ownOnlineAnswer = onlineRevealAnswers.find((onlineAnswer) => (
                    onlineAnswer.category === category && onlineAnswer.playerId === room.playerId
                  ));
                  const ownOnlineDisputeVote = ownOnlineAnswer?.dispute?.votes.find((vote) => (
                    vote.voterPlayerId === room.playerId
                  ))?.verdict as DisputeVote | undefined;
                  const categoryOnlineAnswers = onlineRevealAnswers
                    .filter((onlineAnswer) => (
                      onlineAnswer.category === category && onlineAnswer.playerId !== room.playerId
                    ))
                    .sort((a, b) => (
                      Number(b.playerId === assignedHumanScoringTargetId) - Number(a.playerId === assignedHumanScoringTargetId)
                    ));
                  const categoryBotAnswers = botRoundAnswers
                    .filter((botAnswer) => botAnswer.category === category)
                    .sort((a, b) => (
                      Number(b.botId === assignedBotScoringTargetId) - Number(a.botId === assignedBotScoringTargetId)
                    ));
                  const isScoreStep = scoringStep === 'score';
                  const isReviewStep = scoringStep === 'review';
                  const isOnlineSelfScoreStep = room.isOnline && scoringOwner === 'Self' && isScoreStep;
                  const verdict = isOnlineSelfScoreStep
                    ? verdicts[category]
                    : getVisibleSelfVerdict(category, ownOnlineAnswer);
                  const points = room.isOnline && ownOnlineAnswer && !isOnlineSelfScoreStep && verdict === ownOnlineAnswer.verdict
                    ? ownOnlineAnswer.points
                    : scoreAnswer({ verdict });
                  const selfScoreReason = scoreReasons[getScoreReasonKey('self', category)];

                  return (
                    <View
                      key={category}
                      style={[styles.revealRow, { backgroundColor: laneColor(index) }, (isDisputed || Boolean(ownOnlineAnswer?.dispute)) && styles.disputedAnswerRow]}
                    >
                      <View style={styles.revealTopLine}>
                        <View>
                          <Text style={styles.label}>{category}</Text>
                          <Text style={styles.playerMeta}>You</Text>
                          <Text style={answer ? styles.answerText : styles.emptyAnswerText}>
                            {answer || 'No answer'}
                          </Text>
                        </View>
                        <View style={[styles.pointsBadge, getScoreToneStyle(verdict)]}>
                          <Text style={styles.pointsText}>{getScoreBadgeLabel(answer, verdict, points)}</Text>
                        </View>
                      </View>

                      {answer ? (
                        <View style={styles.answerToolRow}>
                          {renderFactCheckButton({ answer, category, playerName: 'You' })}
                        </View>
                      ) : null}

                      {!room?.isOnline && scoringOwner === 'Self' && isScoreStep ? (
                        <View style={styles.selfScorePanel}>
                          <Text style={styles.settingRowMeta}>Score your answer</Text>
                          <View style={styles.verdictRow}>
                            {(['valid', 'duplicate', 'variant', 'invalid'] as const).map((option) => (
                              <Pressable
                                disabled={isBlank || isOnlineScoringExpired}
                                key={option}
                                onPress={() => {
                                  gameAudio.playTap();
                                  updateVerdict(category, option);
                                  rememberScoredWord(category, option);
                                  if (option === 'valid' || option === 'variant' || option === 'invalid') {
                                    maybeAskScoreReason({
                                      answer,
                                      category,
                                      playerName: 'You',
                                      targetId: 'self',
                                      verdict: option,
                                    });
                                  }
                                }}
                                style={({ pressed }) => [
                                  styles.verdictButton,
                                  verdict === option && styles.verdictButtonSelected,
                                  verdict === option && getScoreToneStyle(option),
                                  (isBlank || isOnlineScoringExpired) && styles.verdictButtonDisabled,
                                  pressed && !isBlank && !isOnlineScoringExpired && styles.buttonPressed,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.verdictButtonText,
                                    verdict === option && styles.verdictButtonTextSelected,
                                  ]}
                                >
                                  {VERDICT_LABELS[option]}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                          {selfScoreReason ? (
                            <Text style={styles.scoreReasonText}>Reason: {selfScoreReason}</Text>
                          ) : null}
                        </View>
                      ) : null}

                      {isBotDisputed && isReviewStep ? (
                        <View style={styles.opponentChallengeCard}>
                          <View style={styles.settingRowMain}>
                            {liveBrawlSystemScoresBots ? (
                              <Users color={INK} size={18} strokeWidth={3} />
                            ) : (
                              <Bot color={INK} size={18} strokeWidth={3} />
                            )}
                            <Text style={styles.disputeButtonText}>
                              {botPlayers[0]?.name ?? 'Opponent'} disputed your score.
                            </Text>
                          </View>
                          <Text style={styles.disputeResultText}>
                            Reason: {botCategoryDisputeReasons[category] ?? 'Opponent wants the session to check this score.'}
                          </Text>
                          <Text style={styles.disputeResultText}>
                            Their call: {formatDisputeVote(botSuggestedVote)}
                          </Text>
                        </View>
                      ) : null}

                      {categoryOnlineAnswers.length ? (
                        <View style={styles.botAnswerList}>
                          {categoryOnlineAnswers.map((onlineAnswer) => {
                            const userSyncedVote = onlineAnswer.votes.find((vote) => vote.voterPlayerId === room.playerId)?.verdict;
                            const userDisputeVote = onlineAnswer.dispute?.votes.find((vote) => vote.voterPlayerId === room.playerId)?.verdict;
                            const canScoreOnlineAnswer = activeScoringTarget === 'players' && humanScoringWork.required.some((answer) => answer.id === onlineAnswer.id) && !scoringPolicy.scoringComplete && scoringPolicy.submissionsReady;
                            const onlineScoreReason = scoreReasons[getScoreReasonKey(onlineAnswer.playerId, category)];

                            return (
                              <View key={onlineAnswer.id} style={[styles.botAnswerCard, onlineAnswer.dispute && styles.disputedAnswerRow]}>
                                <View style={styles.botAnswerRow}>
                                  <View style={styles.settingRowMain}>
                                    <Users color={INK} size={18} strokeWidth={3} />
                                    <View style={styles.botAnswerCopy}>
                                      <Text style={styles.botAnswerName}>{onlineAnswer.playerName}</Text>
                                      <Text style={onlineAnswer.answer ? styles.botAnswerText : styles.emptyAnswerText}>
                                        {onlineAnswer.answer || 'No answer'}
                                      </Text>
                                    </View>
                                  </View>
                                  <View style={[styles.pointsBadgeSmall, getScoreToneStyle(onlineAnswer.verdict)]}>
                                    <Text style={styles.botAnswerPoints}>
                                      {getScoreBadgeLabel(onlineAnswer.answer, onlineAnswer.verdict, onlineAnswer.points).replace(' pts', '')}
                                    </Text>
                                  </View>
                                </View>
                                <Text style={styles.settingRowMeta}>
                                  Score: {onlineAnswer.verdict === 'blank' ? 'Pending' : VERDICT_LABELS[onlineAnswer.verdict] ?? onlineAnswer.verdict} - Votes: {onlineAnswer.votes.length}
                                  {userSyncedVote ? ` - You: ${formatDisputeVote(userSyncedVote as DisputeVote)}` : ''}
                                </Text>
                                {onlineAnswer.answer && canScoreOnlineAnswer && isScoreStep ? (
                                  <View style={styles.voteRow}>
                                    <Pressable
                                      disabled={isOnlineScoringExpired}
                                      onPress={async () => {
                                        gameAudio.playTap();
                                        const result = await castSyncedAnswerVote(onlineAnswer, 'valid');
                                        if (!result?.accepted) return;
                                        maybeAskScoreReason({
                                          answer: onlineAnswer.answer,
                                          category,
                                          playerName: onlineAnswer.playerName,
                                          targetId: onlineAnswer.playerId,
                                          verdict: 'valid',
                                        });
                                      }}
                                      style={({ pressed }) => [
                                        styles.voteButton,
                                        getScoreActionToneStyle('valid'),
                                        userSyncedVote === 'valid' && styles.voteButtonSelected,
                                        userSyncedVote === 'valid' && getScoreActionSelectedToneStyle('valid'),
                                        isOnlineScoringExpired && styles.disabledButton,
                                        pressed && !isOnlineScoringExpired && styles.buttonPressed,
                                      ]}
                                    >
                                      <Check color={INK} size={18} strokeWidth={3} />
                                      <Text style={styles.voteButtonText}>Unique · 10</Text>
                                    </Pressable>
                                    <Pressable
                                      disabled={isOnlineScoringExpired}
                                      onPress={async () => {
                                        gameAudio.playTap();
                                        const result = await castSyncedAnswerVote(onlineAnswer, 'variant');
                                        if (!result?.accepted) return;
                                        maybeAskScoreReason({
                                          answer: onlineAnswer.answer,
                                          category,
                                          playerName: onlineAnswer.playerName,
                                          targetId: onlineAnswer.playerId,
                                          verdict: 'variant',
                                        });
                                      }}
                                      style={({ pressed }) => [
                                        styles.voteButton,
                                        getScoreActionToneStyle('variant'),
                                        userSyncedVote === 'variant' && styles.voteButtonSelected,
                                        userSyncedVote === 'variant' && getScoreActionSelectedToneStyle('variant'),
                                        isOnlineScoringExpired && styles.disabledButton,
                                        pressed && !isOnlineScoringExpired && styles.buttonPressed,
                                      ]}
                                    >
                                      <Star color={INK} size={18} strokeWidth={3} />
                                      <Text style={styles.voteButtonText}>Shared · 5</Text>
                                    </Pressable>
                                    <Pressable
                                      disabled={isOnlineScoringExpired}
                                      onPress={async () => {
                                        gameAudio.playTap();
                                        const result = await castSyncedAnswerVote(onlineAnswer, 'invalid');
                                        if (!result?.accepted) return;
                                        maybeAskScoreReason({
                                          answer: onlineAnswer.answer,
                                          category,
                                          playerName: onlineAnswer.playerName,
                                          targetId: onlineAnswer.playerId,
                                          verdict: 'invalid',
                                        });
                                      }}
                                      style={({ pressed }) => [
                                        styles.voteButton,
                                        getScoreActionToneStyle('invalid'),
                                        userSyncedVote === 'invalid' && styles.voteButtonSelected,
                                        userSyncedVote === 'invalid' && getScoreActionSelectedToneStyle('invalid'),
                                        isOnlineScoringExpired && styles.disabledButton,
                                        pressed && !isOnlineScoringExpired && styles.buttonPressed,
                                      ]}
                                    >
                                      <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                                      <Text style={styles.voteButtonText}>No score · 0</Text>
                                    </Pressable>
                                  </View>
                                ) : onlineAnswer.answer ? (
                                  <Text style={styles.settingRowMeta}>
                                    {isReviewStep
                                      ? 'Review this score. Challenge only if it looks wrong.'
                                      : activeScoringTarget === 'bots'
                                        ? 'This round assigned you to score bots.'
                                        : 'Score this player answer before review.'}
                                  </Text>
                                ) : null}
                                {onlineScoreReason ? (
                                  <Text style={styles.scoreReasonText}>Reason: {onlineScoreReason}</Text>
                                ) : null}
                                <View style={styles.answerToolRow}>
                                  {renderFactCheckButton({
                                    answer: onlineAnswer.answer,
                                    category: onlineAnswer.category,
                                    playerName: onlineAnswer.playerName,
                                  })}
                                  <Pressable
                                    onPress={() => {
                                      gameAudio.playTap();
                                      openAnswerReport(onlineAnswer);
                                    }}
                                    style={({ pressed }) => [styles.reportButton, pressed && styles.buttonPressed]}
                                  >
                                    <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                                    <Text style={styles.reportButtonText}>Report</Text>
                                  </Pressable>
                                  {isReviewStep ? (
                                    <Pressable
                                      disabled={onlineAnswer.dispute?.status === 'open' || isOnlineScoringExpired}
                                      onPress={() => {
                                        gameAudio.playTap();
                                        openSyncedAnswerDispute(onlineAnswer);
                                      }}
                                      style={({ pressed }) => [
                                        styles.disputeButton,
                                        onlineAnswer.dispute?.status === 'open' && styles.disputeButtonActive,
                                        isOnlineScoringExpired && styles.disabledButton,
                                        pressed && onlineAnswer.dispute?.status !== 'open' && !isOnlineScoringExpired && styles.buttonPressed,
                                      ]}
                                    >
                                      <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                                      <Text style={styles.disputeButtonText}>
                                        {onlineAnswer.dispute?.status === 'open' ? 'Session dispute open' : 'Challenge score'}
                                      </Text>
                                    </Pressable>
                                  ) : null}
                                </View>
                                {onlineAnswer.dispute && isReviewStep ? (
                                  <View
                                    onLayout={(event) => {
                                      disputePanelOffsetsRef.current[`online-${onlineAnswer.dispute?.id}`] = event.nativeEvent.layout.y;
                                    }}
                                    style={[
                                      styles.votePanel,
                                      highlightedDisputeId === `online-${onlineAnswer.dispute.id}` && styles.votePanelHighlighted,
                                    ]}
                                  >
                                    {renderDisputeFocusCard({
                                      answer: onlineAnswer.answer,
                                      category,
                                      currentVerdict: onlineAnswer.verdict,
                                      playerName: onlineAnswer.playerName,
                                      points: onlineAnswer.points,
                                    })}
                                    <Text style={styles.settingRowTitle}>Session dispute vote</Text>
                                    <Text style={styles.settingRowMeta}>
                                      {onlineAnswer.dispute.isResolved
                                        ? `Resolved as ${onlineAnswer.dispute.finalVerdict ?? 'final vote'}.`
                                        : `${onlineAnswer.dispute.votes.length + onlineAnswer.dispute.botVoteCount}/${onlineAnswer.dispute.expectedVoteCount} votes cast${onlineAnswer.dispute.botVoteCount ? liveBrawlSystemScoresBots ? ', including system votes' : ', including CPU votes' : ''}.`}
                                    </Text>
                                    {onlineAnswer.dispute.status === 'open' ? (
                                      <View style={styles.voteRow}>
                                        <Pressable
                                          disabled={isOnlineDisputeExpired}
                                          onPress={() => {
                                            gameAudio.playTap();
                                            submitDisputeVote(onlineAnswer.dispute?.id ?? '', 'valid');
                                          }}
                                          style={({ pressed }) => [
                                            styles.voteButton,
                                            getScoreActionToneStyle('valid'),
                                            userDisputeVote === 'valid' && styles.voteButtonSelected,
                                            userDisputeVote === 'valid' && getScoreActionSelectedToneStyle('valid'),
                                            isOnlineDisputeExpired && styles.disabledButton,
                                            pressed && !isOnlineDisputeExpired && styles.buttonPressed,
                                          ]}
                                        >
                                          <Check color={INK} size={18} strokeWidth={3} />
                                          <Text style={styles.voteButtonText}>Unique · 10</Text>
                                        </Pressable>
                                        <Pressable
                                          disabled={isOnlineDisputeExpired}
                                          onPress={() => {
                                            gameAudio.playTap();
                                            submitDisputeVote(onlineAnswer.dispute?.id ?? '', 'variant');
                                          }}
                                          style={({ pressed }) => [
                                            styles.voteButton,
                                            getScoreActionToneStyle('variant'),
                                            userDisputeVote === 'variant' && styles.voteButtonSelected,
                                            userDisputeVote === 'variant' && getScoreActionSelectedToneStyle('variant'),
                                            isOnlineDisputeExpired && styles.disabledButton,
                                            pressed && !isOnlineDisputeExpired && styles.buttonPressed,
                                          ]}
                                        >
                                          <Star color={INK} size={18} strokeWidth={3} />
                                          <Text style={styles.voteButtonText}>Shared · 5</Text>
                                        </Pressable>
                                        <Pressable
                                          disabled={isOnlineDisputeExpired}
                                          onPress={() => {
                                            gameAudio.playTap();
                                            submitDisputeVote(onlineAnswer.dispute?.id ?? '', 'invalid');
                                          }}
                                          style={({ pressed }) => [
                                            styles.voteButton,
                                            getScoreActionToneStyle('invalid'),
                                            userDisputeVote === 'invalid' && styles.voteButtonSelected,
                                            userDisputeVote === 'invalid' && getScoreActionSelectedToneStyle('invalid'),
                                            isOnlineDisputeExpired && styles.disabledButton,
                                            pressed && !isOnlineDisputeExpired && styles.buttonPressed,
                                          ]}
                                        >
                                          <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                                          <Text style={styles.voteButtonText}>No score · 0</Text>
                                        </Pressable>
                                      </View>
                                    ) : null}
                                  </View>
                                ) : null}
                              </View>
                            );
                          })}
                        </View>
                      ) : null}

                      {categoryBotAnswers.length ? (
                        <View style={styles.botAnswerList}>
                          {categoryBotAnswers.map((botAnswer) => {
	                            const botAnswerDisputeKey = getBotAnswerKey(botAnswer.botId, category);
	                            const isBotAnswerDisputed = disputedBotAnswers.includes(botAnswerDisputeKey);
	                            const botAnswerVote = botAnswerVotes[botAnswerDisputeKey];
	                            const botAnswerPlayerVote = botAnswerPlayerVotes[botAnswerDisputeKey];
	                            const botAnswerBotVotes = botAnswerBotVoteLists[botAnswerDisputeKey] ?? [];
	                            const botCounterVote = botCounterVotes[botAnswerDisputeKey];
                            const canScoreBotAnswer = activeScoringTarget === 'bots' && botAnswer.botId === assignedBotScoringTargetId && isScoreStep;
                            const botScoreReason = scoreReasons[getScoreReasonKey(botAnswer.botId, category)];

                            return (
                              <View key={`${botAnswer.botId}-${category}`} style={[styles.botAnswerCard, isBotAnswerDisputed && styles.disputedAnswerRow]}>
                                <View style={styles.botAnswerRow}>
                                  <View style={styles.settingRowMain}>
                                    {liveBrawlSystemScoresBots ? (
                                      <Users color={INK} size={18} strokeWidth={3} />
                                    ) : (
                                      <Bot color={INK} size={18} strokeWidth={3} />
                                    )}
                                    <View style={styles.botAnswerCopy}>
                                      <Text style={styles.botAnswerName}>{botAnswer.botName}</Text>
                                      <Text style={botAnswer.answer ? styles.botAnswerText : styles.emptyAnswerText}>
                                        {botAnswer.answer || 'No answer'}
                                      </Text>
                                    </View>
                                  </View>
                                  <View style={[styles.pointsBadgeSmall, getScoreToneStyle(botAnswer.verdict)]}>
                                    <Text style={styles.botAnswerPoints}>
                                      {getScoreBadgeLabel(botAnswer.answer, botAnswer.verdict, botAnswer.points).replace(' pts', '')}
                                    </Text>
                                  </View>
                                </View>
                                {botAnswer.answer && canScoreBotAnswer ? (
                                  <>
                                    <Text style={styles.settingRowMeta}>Score bot answer</Text>
                                    <View style={styles.voteRow}>
                                      <Pressable
                                        onPress={() => {
                                          gameAudio.playTap();
                                          updateBotAnswerVerdict(botAnswer.botId, category, 'valid');
                                          maybeAskScoreReason({
                                            answer: botAnswer.answer,
                                            category,
                                            playerName: botAnswer.botName,
                                            targetId: botAnswer.botId,
                                            verdict: 'valid',
                                          });
                                        }}
                                        style={({ pressed }) => [
                                          styles.voteButton,
                                          getScoreActionToneStyle('valid'),
                                          botAnswer.verdict === 'valid' && styles.voteButtonSelected,
                                          botAnswer.verdict === 'valid' && getScoreActionSelectedToneStyle('valid'),
                                          pressed && styles.buttonPressed,
                                        ]}
                                      >
                                        <Check color={INK} size={18} strokeWidth={3} />
                                        <Text style={styles.voteButtonText}>Unique · 10</Text>
                                      </Pressable>
                                      <Pressable
                                        onPress={() => {
                                          gameAudio.playTap();
                                          updateBotAnswerVerdict(botAnswer.botId, category, 'variant');
                                          maybeAskScoreReason({
                                            answer: botAnswer.answer,
                                            category,
                                            playerName: botAnswer.botName,
                                            targetId: botAnswer.botId,
                                            verdict: 'variant',
                                          });
                                        }}
                                        style={({ pressed }) => [
                                          styles.voteButton,
                                          getScoreActionToneStyle('variant'),
                                          botAnswer.verdict === 'variant' && styles.voteButtonSelected,
                                          botAnswer.verdict === 'variant' && getScoreActionSelectedToneStyle('variant'),
                                          pressed && styles.buttonPressed,
                                        ]}
                                      >
                                        <Star color={INK} size={18} strokeWidth={3} />
                                        <Text style={styles.voteButtonText}>Shared · 5</Text>
                                      </Pressable>
                                      <Pressable
                                        onPress={() => {
                                          gameAudio.playTap();
                                          updateBotAnswerVerdict(botAnswer.botId, category, 'invalid');
                                          maybeAskScoreReason({
                                            answer: botAnswer.answer,
                                            category,
                                            playerName: botAnswer.botName,
                                            targetId: botAnswer.botId,
                                            verdict: 'invalid',
                                          });
                                        }}
                                        style={({ pressed }) => [
                                          styles.voteButton,
                                          getScoreActionToneStyle('invalid'),
                                          botAnswer.verdict === 'invalid' && styles.voteButtonSelected,
                                          botAnswer.verdict === 'invalid' && getScoreActionSelectedToneStyle('invalid'),
                                          pressed && styles.buttonPressed,
                                        ]}
                                      >
                                        <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                                        <Text style={styles.voteButtonText}>No score · 0</Text>
                                      </Pressable>
                                    </View>
                                    {botScoreReason ? (
                                      <Text style={styles.scoreReasonText}>Reason: {botScoreReason}</Text>
                                    ) : null}
                                  </>
                                ) : botAnswer.answer ? (
                                  <Text style={styles.settingRowMeta}>
                                    {isReviewStep
                                      ? liveBrawlSystemScoresBots
                                        ? 'Review this player score. Challenge only if it looks wrong.'
                                        : 'Review this CPU score. Challenge only if it looks wrong.'
                                      : activeScoringTarget === 'players'
                                        ? 'This round assigned you to score real players.'
                                        : liveBrawlSystemScoresBots
                                          ? 'Player score is ready for review.'
                                          : 'Bot score is waiting for review.'}
                                  </Text>
                                ) : null}
                                <View style={styles.answerToolRow}>
                                  {renderFactCheckButton({
                                    answer: botAnswer.answer,
                                    category,
                                    playerName: botAnswer.botName,
                                  })}
                                  {isReviewStep ? (
                                    <Pressable
                                      disabled={!botAnswer.answer}
                                      onPress={() => {
                                        gameAudio.playTap();
                                        toggleBotAnswerDispute(botAnswer.botId, category);
                                      }}
                                      style={({ pressed }) => [
                                        styles.disputeButton,
                                        isBotAnswerDisputed && styles.disputeButtonActive,
                                        !botAnswer.answer && styles.verdictButtonDisabled,
                                        pressed && Boolean(botAnswer.answer) && styles.buttonPressed,
                                      ]}
                                    >
                                      <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                                      <Text style={styles.disputeButtonText}>
                                        {isBotAnswerDisputed ? 'Score challenged' : `Challenge ${botAnswer.botName}'s score`}
                                      </Text>
                                    </Pressable>
                                  ) : null}
                                </View>
                                {isBotAnswerDisputed ? (
                                  <View
                                    onLayout={(event) => {
                                      disputePanelOffsetsRef.current[`bot-${botAnswerDisputeKey}`] = event.nativeEvent.layout.y;
                                    }}
                                    style={[
                                      styles.votePanel,
                                      highlightedDisputeId === `bot-${botAnswerDisputeKey}` && styles.votePanelHighlighted,
                                    ]}
                                  >
                                    {renderDisputeFocusCard({
                                      answer: botAnswer.answer,
                                      category,
                                      currentVerdict: botAnswer.verdict,
                                      playerName: botAnswer.botName,
                                      points: botAnswer.points,
                                    })}
                                    <Text style={styles.settingRowTitle}>Choose final score for {botAnswer.botName}</Text>
	                                    <Text style={styles.settingRowMeta}>
	                                      {botAnswer.botName} argues for {formatDisputeVote(botCounterVote)}. Pick the final result below.
	                                    </Text>
	                                    <View style={styles.voteLedger}>
	                                      <Text style={styles.voteLedgerText}>
	                                        You: {formatDisputeVote(botAnswerPlayerVote)}
	                                      </Text>
	                                      {botAnswerBotVotes.map((botVote) => (
	                                        <Text key={`${botAnswerDisputeKey}-${botVote.botId}`} style={styles.voteLedgerText}>
	                                          {botVote.botName}: {formatDisputeVote(botVote.vote)}
	                                        </Text>
	                                      ))}
	                                    </View>
	                                    {botAnswerVote ? (
	                                      <Text style={styles.disputeResultText}>
	                                        Majority result: {formatDisputeVote(botAnswerVote)}
	                                      </Text>
	                                    ) : null}
                                    <View style={styles.voteRow}>
                                      <Pressable
                                        onPress={() => {
                                          gameAudio.playTap();
                                          castBotAnswerVote(botAnswer.botId, category, 'valid');
                                        }}
                                        style={({ pressed }) => [
                                          styles.voteButton,
                                          getScoreActionToneStyle('valid'),
                                          botAnswerVote === 'valid' && styles.voteButtonSelected,
                                          botAnswerVote === 'valid' && getScoreActionSelectedToneStyle('valid'),
                                          pressed && styles.buttonPressed,
                                        ]}
                                      >
                                        <Check color={INK} size={18} strokeWidth={3} />
                                        <Text style={styles.voteButtonText}>Unique · 10</Text>
                                      </Pressable>
                                      <Pressable
                                        onPress={() => {
                                          gameAudio.playTap();
                                          castBotAnswerVote(botAnswer.botId, category, 'variant');
                                        }}
                                        style={({ pressed }) => [
                                          styles.voteButton,
                                          getScoreActionToneStyle('variant'),
                                          botAnswerVote === 'variant' && styles.voteButtonSelected,
                                          botAnswerVote === 'variant' && getScoreActionSelectedToneStyle('variant'),
                                          pressed && styles.buttonPressed,
                                        ]}
                                      >
                                        <Star color={INK} size={18} strokeWidth={3} />
                                        <Text style={styles.voteButtonText}>Shared · 5</Text>
                                      </Pressable>
                                      <Pressable
                                        onPress={() => {
                                          gameAudio.playTap();
                                          castBotAnswerVote(botAnswer.botId, category, 'invalid');
                                        }}
                                        style={({ pressed }) => [
                                          styles.voteButton,
                                          getScoreActionToneStyle('invalid'),
                                          botAnswerVote === 'invalid' && styles.voteButtonSelected,
                                          botAnswerVote === 'invalid' && getScoreActionSelectedToneStyle('invalid'),
                                          pressed && styles.buttonPressed,
                                        ]}
                                      >
                                        <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                                        <Text style={styles.voteButtonText}>No score · 0</Text>
                                      </Pressable>
                                    </View>
                                  </View>
                                ) : null}
                              </View>
                            );
                          })}
                        </View>
                      ) : null}

                      {room.isOnline && isReviewStep ? (
                        <View
                          onLayout={(event) => {
                            if (ownOnlineAnswer?.dispute) {
                              disputePanelOffsetsRef.current[`online-${ownOnlineAnswer.dispute.id}`] = event.nativeEvent.layout.y;
                            }
                          }}
                          style={[
                            styles.votePanel,
                            ownOnlineAnswer?.dispute && highlightedDisputeId === `online-${ownOnlineAnswer.dispute.id}` && styles.votePanelHighlighted,
                          ]}
                        >
                          {ownOnlineAnswer ? renderDisputeFocusCard({
                            answer: ownOnlineAnswer.answer,
                            category,
                            currentVerdict: ownOnlineAnswer.verdict,
                            playerName: 'You',
                            points: ownOnlineAnswer.points,
                          }) : null}
                          <Text style={styles.settingRowTitle}>
                            {ownOnlineAnswer?.dispute ? 'Session dispute vote' : ownOnlineAnswer ? 'Challenge your score' : 'Other players score this'}
                          </Text>
                          <Text style={styles.settingRowMeta}>
                            {ownOnlineAnswer?.dispute
                              ? ownOnlineAnswer.dispute.isResolved
                                ? `Resolved as ${ownOnlineAnswer.dispute.finalVerdict ?? 'final vote'}.`
                                : `${ownOnlineAnswer.dispute.votes.length + ownOnlineAnswer.dispute.botVoteCount}/${ownOnlineAnswer.dispute.expectedVoteCount} votes cast${ownOnlineAnswer.dispute.botVoteCount ? liveBrawlSystemScoresBots ? ', including system votes' : ', including CPU votes' : ''}.`
                              : ownOnlineAnswer
                                ? `Opponents scored this as ${formatDisputeVote(ownOnlineAnswer.verdict as DisputeVote)}. If that is wrong, open a session dispute.`
                              : 'You score their answers, they score yours. The round cannot finish until every active player has voted.'}
                          </Text>
                          {ownOnlineAnswer?.dispute?.status === 'open' ? (
                            <View style={styles.voteRow}>
                              <Pressable
                                disabled={isOnlineDisputeExpired}
                                onPress={() => {
                                  gameAudio.playTap();
                                  submitDisputeVote(ownOnlineAnswer.dispute?.id ?? '', 'valid');
                                }}
                                style={({ pressed }) => [
                                  styles.voteButton,
                                  getScoreActionToneStyle('valid'),
                                  ownOnlineDisputeVote === 'valid' && styles.voteButtonSelected,
                                  ownOnlineDisputeVote === 'valid' && getScoreActionSelectedToneStyle('valid'),
                                  isOnlineDisputeExpired && styles.disabledButton,
                                  pressed && !isOnlineDisputeExpired && styles.buttonPressed,
                                ]}
                              >
                                <Check color={INK} size={18} strokeWidth={3} />
                                <Text style={styles.voteButtonText}>Unique · 10</Text>
                              </Pressable>
                              <Pressable
                                disabled={isOnlineDisputeExpired}
                                onPress={() => {
                                  gameAudio.playTap();
                                  submitDisputeVote(ownOnlineAnswer.dispute?.id ?? '', 'variant');
                                }}
                                style={({ pressed }) => [
                                  styles.voteButton,
                                  getScoreActionToneStyle('variant'),
                                  ownOnlineDisputeVote === 'variant' && styles.voteButtonSelected,
                                  ownOnlineDisputeVote === 'variant' && getScoreActionSelectedToneStyle('variant'),
                                  isOnlineDisputeExpired && styles.disabledButton,
                                  pressed && !isOnlineDisputeExpired && styles.buttonPressed,
                                ]}
                              >
                                <Star color={INK} size={18} strokeWidth={3} />
                                <Text style={styles.voteButtonText}>Shared · 5</Text>
                              </Pressable>
                              <Pressable
                                disabled={isOnlineDisputeExpired}
                                onPress={() => {
                                  gameAudio.playTap();
                                  submitDisputeVote(ownOnlineAnswer.dispute?.id ?? '', 'invalid');
                                }}
                                style={({ pressed }) => [
                                  styles.voteButton,
                                  getScoreActionToneStyle('invalid'),
                                  ownOnlineDisputeVote === 'invalid' && styles.voteButtonSelected,
                                  ownOnlineDisputeVote === 'invalid' && getScoreActionSelectedToneStyle('invalid'),
                                  isOnlineDisputeExpired && styles.disabledButton,
                                  pressed && !isOnlineDisputeExpired && styles.buttonPressed,
                                ]}
                              >
                                <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                                <Text style={styles.voteButtonText}>No score · 0</Text>
                              </Pressable>
                            </View>
                          ) : ownOnlineAnswer && answer && !ownOnlineAnswer.dispute ? (
                            <Pressable
                              disabled={isOnlineScoringExpired}
                              onPress={() => {
                                gameAudio.playTap();
                                openSyncedAnswerDispute(ownOnlineAnswer);
                              }}
                              style={({ pressed }) => [
                                styles.disputeButton,
                                isOnlineScoringExpired && styles.disabledButton,
                                pressed && !isOnlineScoringExpired && styles.buttonPressed,
                              ]}
                            >
                              <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                              <Text style={styles.disputeButtonText}>Open session dispute</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : !room.isOnline && scoringOwner === 'Opponents' && isReviewStep ? (
                        <View style={styles.votePanel}>
                          {renderDisputeFocusCard({
                            answer,
                            category,
                            currentVerdict: verdict,
                            playerName: 'You',
                            points,
                          })}
                          <Text style={styles.settingRowTitle}>Opponent scored this</Text>
                          <Text style={styles.settingRowMeta}>
                            Result: {formatDisputeVote(verdict as DisputeVote)}. Challenge only if the score is wrong.
                          </Text>
                          <Pressable
                            disabled={isBlank}
                            onPress={() => {
                              gameAudio.playTap();
                              toggleDispute(category);
                            }}
                            style={({ pressed }) => [
                              styles.disputeButton,
                              isDisputed && styles.disputeButtonActive,
                              isBlank && styles.verdictButtonDisabled,
                              pressed && !isBlank && styles.buttonPressed,
                            ]}
                          >
                            <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                            <Text style={styles.disputeButtonText}>
                              {isDisputed ? 'Challenge open - choose final score' : 'Challenge score'}
                            </Text>
                          </Pressable>
                        </View>
                      ) : isReviewStep ? (
                        <View style={styles.votePanel}>
                          <Text style={styles.settingRowTitle}>Review step</Text>
                          <Text style={styles.settingRowMeta}>
                            Check scores and challenge anything that looks wrong before finishing.
                          </Text>
                        </View>
                      ) : null}

                      {(isDisputed || isBotDisputed) && isReviewStep ? (
                        <View
                          onLayout={(event) => {
                            disputePanelOffsetsRef.current[`player-${category}`] = event.nativeEvent.layout.y;
                          }}
                          style={[
                            styles.votePanel,
                            highlightedDisputeId === `player-${category}` && styles.votePanelHighlighted,
                          ]}
                        >
                          {renderDisputeFocusCard({
                            answer,
                            category,
                            currentVerdict: verdict,
                            playerName: 'You',
                            points,
                          })}
                          <Text style={styles.settingRowTitle}>Choose final score</Text>
	                          <Text style={styles.settingRowMeta}>
	                            {isBotDisputed
	                              ? `${botPlayers[0]?.name ?? 'Opponent'} says: ${botCategoryDisputeReasons[category] ?? 'check this score'}. Pick the final result below.`
	                              : 'Pick what this answer should be worth.'}
	                          </Text>
	                          <View style={styles.voteLedger}>
	                            <Text style={styles.voteLedgerText}>
	                              You: {formatDisputeVote(categoryPlayerVote)}
	                            </Text>
	                            {categoryBotVotes.map((botVote) => (
	                              <Text key={`${category}-${botVote.botId}`} style={styles.voteLedgerText}>
	                                {botVote.botName}: {formatDisputeVote(botVote.vote)}
	                              </Text>
	                            ))}
	                          </View>
	                          {categoryVote ? (
	                            <Text style={styles.disputeResultText}>
	                              Majority result: {formatDisputeVote(categoryVote)}
	                            </Text>
	                          ) : null}
                          <View style={styles.voteRow}>
                            <Pressable
                              onPress={() => {
                                gameAudio.playTap();
                                castCategoryVote(category, 'valid');
                              }}
                              style={({ pressed }) => [
                                styles.voteButton,
                                getScoreActionToneStyle('valid'),
                                categoryVote === 'valid' && styles.voteButtonSelected,
                                categoryVote === 'valid' && getScoreActionSelectedToneStyle('valid'),
                                pressed && styles.buttonPressed,
                              ]}
                            >
                              <Check color={INK} size={18} strokeWidth={3} />
                              <Text style={styles.voteButtonText}>Unique · 10</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => {
                                gameAudio.playTap();
                                castCategoryVote(category, 'variant');
                              }}
                              style={({ pressed }) => [
                                styles.voteButton,
                                getScoreActionToneStyle('variant'),
                                categoryVote === 'variant' && styles.voteButtonSelected,
                                categoryVote === 'variant' && getScoreActionSelectedToneStyle('variant'),
                                pressed && styles.buttonPressed,
                              ]}
                            >
                              <Star color={INK} size={18} strokeWidth={3} />
                              <Text style={styles.voteButtonText}>Shared · 5</Text>
                            </Pressable>
                            <Pressable
                              onPress={() => {
                                gameAudio.playTap();
                                castCategoryVote(category, 'invalid');
                              }}
                              style={({ pressed }) => [
                                styles.voteButton,
                                getScoreActionToneStyle('invalid'),
                                categoryVote === 'invalid' && styles.voteButtonSelected,
                                categoryVote === 'invalid' && getScoreActionSelectedToneStyle('invalid'),
                                pressed && styles.buttonPressed,
                              ]}
                            >
                              <ShieldQuestion color={INK} size={18} strokeWidth={3} />
                              <Text style={styles.voteButtonText}>No score · 0</Text>
                            </Pressable>
                          </View>
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
              )}

              {scoringStep === 'score' && activeScoreCard ? null : (
              <View style={styles.scoreCard}>
                <Text style={styles.infoLabel}>Round total</Text>
                <Text style={styles.scoreText}>{totalScore} points</Text>
              </View>
              )}

              {scoringStep === 'review' && disputeSummaryRows.length ? (
                <View style={styles.disputeSummaryCard}>
                  <View style={styles.dashboardTopLine}>
                    <Text style={styles.dashboardLabel}>Dispute summary</Text>
                    <Text style={styles.dashboardStatus}>
                      {hasUnresolvedDisputes ? `${unresolvedDisputeCount} open` : `${disputeSummaryRows.length} checked`}
                    </Text>
                  </View>
                  {hasUnresolvedDisputes ? (
                    <Text style={styles.helperText}>
                      Resolve every challenged score before finishing the round.
                    </Text>
                  ) : null}
                  {disputeSummaryRows.map((row) => (
                    <View key={row.id} style={styles.disputeSummaryRow}>
                      <View style={styles.creatorCopy}>
                        <Text style={styles.settingRowTitle}>{row.title}</Text>
                        <Text style={styles.settingRowMeta}>{row.meta}</Text>
                        <Text style={styles.disputeResultText}>Result: {row.result}</Text>
                      </View>
                      <Text style={styles.pointsText}>{row.points}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={styles.actions}>
                {scoringStep === 'score' ? (
                  <Pressable
                    disabled={!scoringPolicy.canReview}
                    onPress={scoringNavigation.review}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      !scoringPolicy.canReview && styles.disabledButton,
                      pressed && scoringPolicy.canReview && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>{reviewLabel}</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    disabled={!scoringPolicy.canFinish}
                    onPress={scoringNavigation.finish}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      !scoringPolicy.canFinish && styles.disabledButton,
                      finishDisputeCount > 0 && styles.warningButton,
                      pressed && scoringPolicy.canFinish && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>{finishLabel}</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => {
                  gameAudio.playTap();
                  requestLeaveRoom();
                }} style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}>
                  <Text style={styles.ghostButtonText}>Quit Game</Text>
                </Pressable>
              </View>
              </View>
              ) : null}
            </View>
          ) : null}

          {screen === 'leaderboard' && room ? (
            <View style={[styles.panel, Platform.OS === 'web' && styles.webPanel]}>
              <View style={styles.lobbyHeader}>
                <View style={styles.screenTopBarCompact}>
                  <Pressable
                    accessibilityLabel="Back"
                    onPress={() => {
                      gameAudio.playTap();
                      setScreen('lobby');
                    }}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.buttonPressed]}
                  >
                    <ArrowLeft color={INK} size={24} strokeWidth={3} />
                  </Pressable>
                  <View>
                    <Text style={styles.eyebrow}>Leaderboard</Text>
                    <Text style={styles.heading}>Session {room.code}</Text>
                  </View>
                </View>
                <View style={styles.codeBadge}>
                  <Text style={styles.codeBadgeLabel}>{matchDurationSeconds ? 'Time' : 'Rounds'}</Text>
                  <Text style={styles.codeBadgeText}>
                    {matchDurationSeconds ? formatClock(matchTimeRemaining) : roundHistory.length}
                  </Text>
                </View>
              </View>

              <View style={styles.leaderboardHero}>
                <View>
                  <Text style={styles.infoLabel}>Leader</Text>
                  <Text style={styles.leaderName}>{leader?.name ?? room.playerName}</Text>
                </View>
                <Text style={styles.leaderScore}>{leader?.score ?? lifetimeScore}</Text>
              </View>

              <View style={styles.roomDashboard}>
                <View style={styles.dashboardTopLine}>
                  <Text style={styles.dashboardLabel}>Session result</Text>
                  <Text style={styles.dashboardStatus}>{isMatchComplete ? 'Game over' : 'Scoreboard'}</Text>
                </View>
                <Text style={styles.dashboardTitle}>{isMatchComplete ? resultTitle : 'Who is winning?'}</Text>
                <Text style={styles.dashboardCopy}>
                  {isMatchComplete
                    ? `Position ${resultPositionLabel}. ${lastMatchResult?.pointsEarned ?? 0} points added this round.`
                    : 'Next round when the session is ready.'}
                </Text>

                  <View style={styles.statStrip}>
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{localPlayerScore}</Text>
                    <Text style={styles.statLabel}>Your pts</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>
                      {matchDurationSeconds ? formatClock(matchTimeRemaining) : roundHistory.length}
                    </Text>
                    <Text style={styles.statLabel}>{matchDurationSeconds ? 'Left' : 'Rounds'}</Text>
                  </View>
                  <View style={styles.statDivider} />
                  <View style={styles.statItem}>
                    <Text style={styles.statValue}>{roundHistory.at(-1)?.letter ?? '-'}</Text>
                    <Text style={styles.statLabel}>Last letter</Text>
                  </View>
                </View>
              </View>

              {disputeSummaryRows.length ? (
                <View style={styles.disputeSummaryCard}>
                  <View style={styles.dashboardTopLine}>
                    <Text style={styles.dashboardLabel}>Round issues</Text>
                    <Text style={styles.dashboardStatus}>{disputeSummaryRows.length} resolved</Text>
                  </View>
                  <Text style={styles.helperText}>
                    Challenges from this round are kept here so you can see what was questioned before continuing.
                  </Text>
                  {disputeSummaryRows.map((row) => (
                    <View key={`leaderboard-${row.id}`} style={styles.disputeSummaryRow}>
                      <View style={styles.creatorCopy}>
                        <Text style={styles.settingRowTitle}>{row.title}</Text>
                        <Text style={styles.settingRowMeta}>{row.meta}</Text>
                        <Text style={styles.disputeResultText}>Final: {row.result}</Text>
                      </View>
                      <Text style={styles.pointsText}>{row.points}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              {isMatchComplete ? (
                <View style={styles.matchResultCard}>
                  <View style={styles.dashboardTopLine}>
                    <Text style={styles.dashboardLabel}>Game over</Text>
                    <Text style={styles.dashboardStatus}>{lastMatchResult?.isWinner ? 'Winner' : 'Finished'}</Text>
                  </View>
                  <Text style={styles.matchResultTitle}>{resultTitle}</Text>
                  <View style={styles.resultGrid}>
                    <View style={styles.resultTile}>
                      <Trophy color={INK} size={22} strokeWidth={3} />
                      <Text style={styles.resultValue}>{resultPositionLabel}</Text>
                      <Text style={styles.resultLabel}>Position</Text>
                    </View>
                    <View style={styles.resultTile}>
                      <Star color={INK} size={22} strokeWidth={3} />
                      <Text style={styles.resultValue}>{lastMatchResult?.playerScore ?? localPlayerScore}</Text>
                      <Text style={styles.resultLabel}>Total points</Text>
                    </View>
                    <View style={styles.resultTile}>
                      <Sparkles color={INK} size={22} strokeWidth={3} />
                      <Text style={styles.resultValue}>+{lastMatchResult?.pointsEarned ?? 0}</Text>
                      <Text style={styles.resultLabel}>Last round</Text>
                    </View>
                  </View>
                  <View style={styles.resultAchievementRow}>
                    <Medal color={INK} size={22} strokeWidth={3} />
                    <Text style={styles.resultAchievementText}>
                      {lastMatchResult?.achievementUnlockedLabels.length
                        ? `Unlocked: ${lastMatchResult.achievementUnlockedLabels.join(', ')}`
                        : `League: ${playerLeague.name}${nextLeague ? `, ${pointsToNextLeague} pts to ${nextLeague.name}` : ', top league'}`}
                    </Text>
                  </View>
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Standings</Text>
                {leaderboardEntries.map((entry, index) => (
                  <View key={entry.id} style={styles.historyRow}>
                    <View style={styles.settingRowMain}>
                      {entry.id === currentLeaderboardPlayerId ? (
                        <View style={[styles.miniAvatar, { backgroundColor: selectedAvatar.accent }]}>
                          <SelectedAvatarIcon color={INK} size={17} strokeWidth={3} />
                        </View>
                      ) : (
                        <Bot color={INK} size={22} strokeWidth={3} />
                      )}
                      <View>
                        <Text style={styles.historyTitle}>{index + 1}. {entry.name}</Text>
                          <Text style={styles.playerMeta}>{entry.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.pointsText}>{entry.score} pts</Text>
                  </View>
                ))}
              </View>

              {room.isOnline ? (
                <View style={styles.section}>
                  <Text style={styles.sectionTitle}>Online round scores</Text>
                  {onlineScoreboardEntries.length ? (
                    onlineScoreboardEntries.map((entry, index) => (
                      <View key={entry.playerId} style={styles.historyRow}>
                        <View>
                          <Text style={styles.historyTitle}>{index + 1}. {entry.playerName}</Text>
                          <Text style={styles.playerMeta}>{entry.answeredCount}/{selectedCategories.length} answered</Text>
                        </View>
                        <Text style={styles.pointsText}>{entry.score} pts</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.bodyText}>Waiting for online scores.</Text>
                  )}
                </View>
              ) : null}

              {room.isOnline ? (
                <View style={styles.section}>
                  <View style={styles.sectionHeaderRow}>
                    <Text style={styles.sectionTitle}>Beta feedback</Text>
                    <ShieldQuestion color={INK} size={22} strokeWidth={3} />
                  </View>
                  <Text style={styles.bodyText}>
                    Flag confusing flow, bad scoring, or anything that blocks the session.
                  </Text>
                  <Pressable
                    onPress={() => {
                      gameAudio.playTap();
                      openBetaFeedbackReport();
                    }}
                    style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                  >
                    <ShieldQuestion color={INK} size={20} strokeWidth={3} />
                    <Text style={styles.secondaryButtonText}>Send Feedback</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Round history</Text>
                {(room.isOnline ? onlinePlayerRoundHistory : roundHistory).length ? (
                  (room.isOnline ? onlinePlayerRoundHistory : roundHistory).map((round) => (
                    <View key={'id' in round ? round.id : round.roundId} style={styles.historyRow}>
                      <View>
                        <Text style={styles.historyTitle}>Round {round.roundNumber}</Text>
                        <Text style={styles.playerMeta}>
                          Letter {round.letter} - {round.answeredCount}/{'categoryCount' in round ? round.categoryCount : selectedCategories.length} answered
                        </Text>
                      </View>
                      <Text style={styles.pointsText}>{round.score} pts</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.bodyText}>No finished rounds yet.</Text>
                )}
              </View>

              <View style={styles.actions}>
                {isMatchComplete ? (
                  <>
                    <Pressable
                      onPress={() => {
                        gameAudio.playStart();
                        resetMatch();
                      }}
                      style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
                    >
                      <Text style={styles.primaryButtonText}>Play Again</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        gameAudio.playTap();
                        requestLeaveRoom();
                      }}
                      style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
                    >
                      <Text style={styles.secondaryButtonText}>New Game</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable
                    disabled={isRoundBusy}
                    onPress={() => {
                      gameAudio.playTap();
                      setShowNextLetterModal(true);
                    }}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      isRoundBusy && styles.disabledButton,
                      pressed && !isRoundBusy && styles.buttonPressed,
                    ]}
                  >
                    <Text style={styles.primaryButtonText}>
                      Choose Next Letter
                    </Text>
                  </Pressable>
                )}
                <Pressable onPress={() => {
                  gameAudio.playTap();
                  if (isMatchComplete) {
                    setScreen('lobby');
                    return;
                  }

                  requestLeaveRoom();
                }} style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}>
                  <Text style={styles.ghostButtonText}>{isMatchComplete ? 'Back to Lobby' : 'Quit Game'}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
      {screen === 'round' && room ? (
        <View pointerEvents="none" style={styles.roundTimerOverlayWrap}>
          <View style={[styles.boardTimerPill, isTimerUrgent && styles.boardTimerPillUrgent]}>
            <Timer color="#FFFFFF" size={18} strokeWidth={3} />
            <Text style={styles.boardTimerText}>{roundSubmitted ? 'Done' : `${timeRemaining}s`}</Text>
          </View>
        </View>
      ) : null}
      {roomActivityNotice ? (
        <View pointerEvents="none" style={styles.activityToastWrap}>
          <View style={styles.activityToast}>
            <Users color={INK} size={18} strokeWidth={3} />
            <Text style={styles.activityToastText}>{roomActivityNotice}</Text>
          </View>
        </View>
      ) : null}
      <Modal
        animationType="fade"
        onRequestClose={() => setShowNextLetterModal(false)}
        transparent
        visible={showNextLetterModal && !isMatchComplete}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.letterPickerModal}>
            <View style={styles.modeIconBubble}>
              <KeyRound color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>Next letter</Text>
            {renderLetterPickerCard()}
            <View style={styles.actions}>
              <Pressable
                disabled={isRoundBusy || isOnlineNonPicker || needsPickedLetter}
                onPress={() => {
                  gameAudio.playStart();
                  setShowNextLetterModal(false);
                  startRound();
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  (isRoundBusy || isOnlineNonPicker || needsPickedLetter) && styles.disabledButton,
                  pressed && !isRoundBusy && !isOnlineNonPicker && !needsPickedLetter && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>
                  {isOnlineNonPicker
                    ? `Waiting for ${room?.letterPickerName ?? room?.hostName ?? 'picker'}`
                    : needsPickedLetter
                      ? 'Pick a Letter'
                      : isRoundBusy ? 'Starting...' : 'Start Round'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  gameAudio.playTap();
                  setShowNextLetterModal(false);
                }}
                style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.ghostButtonText}>Back to Scores</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={Boolean(activeScoreReasonTarget)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.leaveRoomModal}>
            <View style={styles.modeIconBubble}>
              <ShieldQuestion color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>
              Why {activeScoreReasonTarget?.verdict === 'variant' ? '5 points' : '0 points'}?
            </Text>
            <Text style={styles.bodyText}>
              {activeScoreReasonTarget
                ? `${activeScoreReasonTarget.playerName} - ${activeScoreReasonTarget.category}: ${activeScoreReasonTarget.answer}`
                : ''}
            </Text>
            <View style={styles.reasonGrid}>
              {activeScoreReasonTarget ? SCORE_REASON_OPTIONS[activeScoreReasonTarget.verdict as 'invalid' | 'variant'].map((reason) => (
                <Pressable
                  key={reason}
                  onPress={() => {
                    gameAudio.playTap();
                    saveScoreReason(reason);
                  }}
                  style={({ pressed }) => [styles.reasonChip, pressed && styles.buttonPressed]}
                >
                  <Text style={styles.reasonChipText}>{reason}</Text>
                </Pressable>
              )) : null}
            </View>
            <View style={styles.actions}>
              <Pressable
                onPress={() => {
                  gameAudio.playTap();
                  setActiveScoreReasonTarget(null);
                }}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.secondaryButtonText}>Skip Reason</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={Boolean(challengeResultNotice)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.leaveRoomModal}>
            <View style={styles.modeIconBubble}>
              <Trophy color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>{challengeResultNotice?.title ?? 'Challenge result'}</Text>
            <Text style={styles.bodyText}>{challengeNoticeMessage}</Text>
            <Pressable
              onPress={() => {
                gameAudio.playTap();
                setChallengeResultNotice(null);
              }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal
        animationType="fade"
        transparent
        visible={Boolean(activeReportTarget)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.leaveRoomModal}>
            <View style={styles.modeIconBubble}>
              <ShieldQuestion color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>{activeReportTarget?.title ?? 'Report'}</Text>
            {activeReportTarget?.playerName ? (
              <Text style={styles.bodyText}>{activeReportTarget.playerName}</Text>
            ) : null}
            <Text style={styles.bodyText}>
              Feedback is saved to the reports review queue with this room, your player id, and any answer/player context.
            </Text>
            <TextInput
              multiline
              onChangeText={(details) => {
                setActiveReportTarget((currentTarget) => currentTarget
                  ? { ...currentTarget, details }
                  : currentTarget);
              }}
              placeholder="What should we review?"
              placeholderTextColor="#6B7280"
              style={styles.reportInput}
              value={activeReportTarget?.details ?? ''}
            />
            {reportNotice ? <Text style={styles.helperText}>{reportNotice}</Text> : null}
            <View style={styles.actions}>
              <Pressable
                disabled={isSendingReport}
                onPress={() => {
                  gameAudio.playTap();
                  sendActiveReport();
                }}
                style={({ pressed }) => [
                  styles.primaryButton,
                  isSendingReport && styles.disabledButton,
                  pressed && !isSendingReport && styles.buttonPressed,
                ]}
              >
                <Text style={styles.primaryButtonText}>{isSendingReport ? 'Sending...' : 'Send Report'}</Text>
              </Pressable>
              <Pressable
                disabled={isSendingReport}
                onPress={() => {
                  gameAudio.playTap();
                  setActiveReportTarget(null);
                  setReportNotice('');
                }}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  isSendingReport && styles.disabledModeCard,
                  pressed && !isSendingReport && styles.buttonPressed,
                ]}
              >
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={Boolean(activeFactCheckTarget)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.leaveRoomModal}>
            <View style={styles.modeIconBubble}>
              <BookOpen color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>Word check</Text>
            <Text style={styles.bodyText}>
              {activeFactCheckTarget?.playerName ? `${activeFactCheckTarget.playerName}: ` : ''}
              {activeFactCheckTarget?.category ?? ''} - {activeFactCheckTarget?.answer ?? ''}
            </Text>
            <View style={styles.scoringStepList}>
              {factCheckResult?.verdict === 'verified' ? (
                <View style={[styles.factCheckVerdict, styles.factCheckVerdictVerified]}>
                  <Check color="#0D8A4F" size={25} strokeWidth={4} />
                  <View><Text style={styles.factCheckVerdictTitle}>Verified word</Text><Text style={styles.factCheckVerdictCopy}>Available for this category.</Text></View>
                </View>
              ) : null}
              {factCheckResult?.verdict === 'invalid' ? (
                <View style={[styles.factCheckVerdict, styles.factCheckVerdictInvalid]}>
                  <X color="#B42318" size={25} strokeWidth={4} />
                  <View><Text style={styles.factCheckVerdictTitle}>Not verified</Text><Text style={styles.factCheckVerdictCopy}>No matching word evidence was found.</Text></View>
                </View>
              ) : null}
              {factCheckResult?.verdict === 'possible' ? (
                <View style={[styles.factCheckVerdict, styles.factCheckVerdictPossible]}>
                  <CircleHelp color="#9A6700" size={25} strokeWidth={4} />
                  <View><Text style={styles.factCheckVerdictTitle}>Possible word</Text><Text style={styles.factCheckVerdictCopy}>It may be valid; players should decide.</Text></View>
                </View>
              ) : null}
              {factCheckResult?.status === 'loading' ? (
                <Text style={styles.settingRowMeta}>Checking server validation...</Text>
              ) : null}
              {factCheckResult?.categoryNote ? (
                <Text style={styles.settingRowMeta}>{factCheckResult.categoryNote}</Text>
              ) : null}
              {factCheckResult?.suggestions.length ? (
                <>
                  <Text style={styles.settingRowTitle}>Close spellings</Text>
                  <Text style={styles.settingRowMeta}>
                    {factCheckResult.suggestions.join(', ')}
                  </Text>
                </>
              ) : null}
              {factCheckResult?.status === 'found' ? (
                <>
                  <Text style={styles.settingRowTitle}>Server check</Text>
                  <Text style={styles.settingRowMeta}>
                    This result comes from the same server validation path used for scoring.
                  </Text>
                  <Text style={styles.factCheckSource}>Source: {factCheckResult.source}</Text>
                </>
              ) : null}
              {factCheckResult?.status === 'not_found' ? (
                <Text style={styles.settingRowMeta}>
                  No trusted category match yet. That does not automatically make it wrong, especially for names, places, brands, or slang.
                </Text>
              ) : null}
              {factCheckResult?.status === 'error' ? (
                <Text style={styles.errorText}>{factCheckResult.error}</Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => {
                gameAudio.playTap();
                setActiveFactCheckTarget(null);
                setFactCheckResult(null);
              }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonText}>Back to Scoring</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={roomExpiredNotice}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.leaveRoomModal}>
            <View style={styles.modeIconBubble}>
              <Timer color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>Session expired</Text>
            <Text style={styles.bodyText}>
              Session {room?.code ?? ''} is no longer available.
            </Text>
            <View style={styles.scoringStepList}>
              <Text style={styles.settingRowMeta}>Create a new session to keep playing.</Text>
              <Text style={styles.settingRowMeta}>Expired sessions cannot accept new rounds or rejoins.</Text>
            </View>
            <Pressable
              onPress={() => {
                gameAudio.playTap();
                dismissExpiredRoom();
              }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonText}>Back Home</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={roomRejoinedNotice}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.leaveRoomModal}>
            <View style={styles.modeIconBubble}>
              <LogIn color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>Rejoined session</Text>
            <Text style={styles.bodyText}>
              You are back in session {room?.code ?? ''}.
            </Text>
            <View style={styles.scoringStepList}>
              <Text style={styles.settingRowMeta}>
                Your name, session role, current round, and saved answers were restored.
              </Text>
              <Text style={styles.settingRowMeta}>
                Scores and votes will keep syncing from the session.
              </Text>
            </View>
            <Pressable
              onPress={() => {
                gameAudio.playTap();
                dismissRejoinedRoomNotice();
              }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={leftRoomNoticeNames.length > 0 && !roomActivityNotice}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.leaveRoomModal}>
            <View style={styles.modeIconBubble}>
              <LogOut color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>Player left</Text>
            <Text style={styles.bodyText}>
              {formatNameList(leftRoomNoticeNames)} left session {room?.code ?? ''}.
            </Text>
            <View style={styles.scoringStepList}>
              <Text style={styles.settingRowMeta}>
                Their original seat stays reserved for 12 seconds. If they return in time, their answers, scores, and votes return with them.
              </Text>
              <Text style={styles.settingRowMeta}>
                The session stays open while active players remain inside. If it becomes empty, it closes after about 30 seconds.
              </Text>
            </View>
            <Pressable
              onPress={() => {
                gameAudio.playTap();
                setLeftRoomNoticeNames([]);
              }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={showLeaveRoomConfirm}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.leaveRoomModal}>
            <View style={styles.modeIconBubble}>
              <LogOut color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>{shouldWarnBeforeLeavingActiveGame ? 'Quit game?' : 'Close session?'}</Text>
            <Text style={styles.bodyText}>
              {shouldWarnBeforeLeavingActiveGame
                ? 'Leaving now quits the current game on this device.'
                : `Close session ${room?.code ?? ''} on this device?`}
            </Text>
            <View style={styles.scoringStepList}>
              <Text style={styles.settingRowMeta}>
                {shouldWarnBeforeLeavingActiveGame
                  ? 'Your current round progress may be abandoned.'
                  : 'You can start or join another session after closing this one.'}
              </Text>
              <Text style={styles.settingRowMeta}>
                {shouldWarnBeforeLeavingActiveGame
                  ? 'Stay if you want to keep playing this brawl.'
                  : `The brawl may stay available for ${roomAvailabilityLabel} if other players are still inside.`}
              </Text>
            </View>
            <View style={styles.actions}>
              <Pressable
                onPress={() => {
                  gameAudio.playTap();
                  setShowLeaveRoomConfirm(false);
                }}
                style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.primaryButtonText}>Stay</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  gameAudio.playTap();
                  confirmLeaveRoom();
                }}
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
              >
                <Text style={styles.secondaryButtonText}>{shouldWarnBeforeLeavingActiveGame ? 'Quit Game' : 'Close Session'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={screen === 'scoring' && showScoringHelp}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.scoringHelpModal}>
            <View style={styles.modeIconBubble}>
              <Star color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>How scoring works</Text>
            <Text style={styles.bodyText}>
              {scoringOwner === 'Opponents'
                ? 'Score the assigned answers first. Then review the scores on your own answers.'
                : 'Score your answers first. Then review the other players’ calls.'}
            </Text>
            <View style={styles.scoringStepList}>
              <Text style={styles.settingRowMeta}>1. Read the category and answer.</Text>
              <Text style={styles.settingRowMeta}>2. Choose 10 Unique, 5 Shared, or 0 No score.</Text>
              <Text style={styles.settingRowMeta}>3. Repeat until every answer is scored.</Text>
              <Text style={styles.settingRowMeta}>4. Review and challenge only obvious mistakes.</Text>
            </View>
            <Pressable
              onPress={() => {
                gameAudio.playTap();
                setDoNotShowScoringHelpAgain((current) => !current);
              }}
              style={({ pressed }) => [styles.checkboxRow, pressed && styles.buttonPressed]}
            >
              <View style={[styles.checkboxBox, doNotShowScoringHelpAgain && styles.checkboxBoxChecked]}>
                {doNotShowScoringHelpAgain ? <Check color={INK} size={16} strokeWidth={3} /> : null}
              </View>
              <Text style={styles.checkboxText}>Do not show this again</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                gameAudio.playTap();
                dismissScoringHelp();
              }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonText}>Got it — start scoring</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="fade"
        transparent
        visible={screen === 'scoring' && Boolean(activeDisputeNotice) && !showScoringHelp}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.scoringHelpModal}>
            <View style={styles.modeIconBubble}>
              <ShieldQuestion color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>
              {disputeNoticeStack.length > 1 ? 'Words disputed' : 'Word disputed'}
            </Text>
            <Text style={styles.bodyText}>
              {disputeNoticeStack.length > 1
                ? `${disputeNoticeStack.length} answers were challenged. Handle them one by one.`
                : `${activeDisputeNotice?.challengerName} challenged your ${activeDisputeNotice?.category} answer.`}
            </Text>
            <View style={styles.noticeStack}>
              {(disputeNoticeStack.length ? disputeNoticeStack : activeDisputeNotice ? [activeDisputeNotice] : []).map((notice, index) => (
                <View
                  key={`${notice.category}-${index}`}
                  style={[
                    styles.noticeStackCard,
                    index > 0 && { transform: [{ translateY: -4 * index }] },
                  ]}
                >
                  <View style={styles.dashboardTopLine}>
                    <Text style={styles.settingRowTitle}>{notice.category}</Text>
                    <Text style={styles.dashboardStatus}>#{index + 1}</Text>
                  </View>
                  <Text style={styles.settingRowMeta}>
                    {notice.challengerName} wants {formatDisputeVote(notice.suggestedVote)}.
                  </Text>
                  <Text style={styles.disputeResultText}>{notice.reason}</Text>
                </View>
              ))}
            </View>
            <View style={styles.scoringStepList}>
              <Text style={styles.settingRowMeta}>Everyone in the session votes.</Text>
              <Text style={styles.settingRowMeta}>Majority wins. A tie gives you final say.</Text>
            </View>
            <Pressable
              onPress={() => {
                gameAudio.playTap();
                setActiveDisputeNotice(null);
              }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonText}>Review Vote</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        animationType="slide"
        transparent
        visible={shouldShowMatchResultModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.matchResultModal}>
            <View style={styles.modeIconBubble}>
              <Trophy color={INK} size={34} strokeWidth={3} />
            </View>
            <Text style={styles.heading}>{resultTitle}</Text>
            <Text style={styles.bodyText}>
              Position {resultPositionLabel}. You scored {lastMatchResult?.playerScore ?? lifetimeScore} points.
            </Text>
            <View style={styles.resultGrid}>
              <View style={styles.resultTile}>
                <Crown color={INK} size={22} strokeWidth={3} />
                <Text style={styles.resultValue}>{resultPositionLabel}</Text>
                <Text style={styles.resultLabel}>Position</Text>
              </View>
              <View style={styles.resultTile}>
                <Sparkles color={INK} size={22} strokeWidth={3} />
                <Text style={styles.resultValue}>+{lastMatchResult?.pointsEarned ?? 0}</Text>
                <Text style={styles.resultLabel}>Round pts</Text>
              </View>
            </View>
            {lastMatchResult?.achievementUnlockedLabels.length ? (
              <View style={styles.resultAchievementRow}>
                <Medal color={INK} size={22} strokeWidth={3} />
                <Text style={styles.resultAchievementText}>
                  Achievement unlocked: {lastMatchResult.achievementUnlockedLabels.join(', ')}
                </Text>
              </View>
            ) : null}
            <Pressable
              onPress={() => {
                gameAudio.playTap();
                setDismissedMatchResultKey(matchResultKey);
              }}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.primaryButtonText}>View Results</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Play Again"
              onPress={() => {
                gameAudio.playStart();
                setDismissedMatchResultKey(matchResultKey);
                void resetMatch();
              }}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}
            >
              <Text style={styles.secondaryButtonText}>Play Again</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  activityToastWrap: {
    alignItems: 'center',
    left: 0,
    paddingHorizontal: 16,
    position: 'absolute',
    right: 0,
    top: 18,
    zIndex: 30,
  },
  activityToast: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: INK,
    borderRadius: 999,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    maxWidth: 520,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: INK,
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  activityToastText: {
    color: INK,
    fontSize: 13,
    fontWeight: '900',
  },
  actions: {
    alignSelf: 'stretch',
    gap: 12,
    marginTop: 24,
    maxWidth: 350,
    width: '100%',
  },
  accomplishmentGrid: {
    gap: 10,
  },
  accomplishmentCopy: {
    flex: 1,
  },
  accomplishmentIconBadge: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 18,
    borderWidth: 2,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  accomplishmentProgress: {
    borderRadius: 999,
    height: '100%',
  },
  accomplishmentTile: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  accomplishmentTitle: {
    color: '#1F2430',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0,
  },
  accomplishmentTrack: {
    backgroundColor: 'rgba(31, 36, 48, 0.16)',
    borderRadius: 999,
    height: 7,
    marginTop: 8,
    overflow: 'hidden',
  },
  avatar: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 24,
    borderWidth: 2,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  avatarOption: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 18,
    borderWidth: 2,
    height: 54,
    justifyContent: 'center',
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: 54,
  },
  avatarOptionSelected: {
    borderWidth: 4,
    transform: [{ translateY: -2 }],
  },
  avatarPickerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  playerAvatarPreview: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 16,
    borderWidth: 2,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  answerCard: {
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    gap: 8,
    marginBottom: 14,
    padding: 12,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  answerIndex: {
    color: '#777166',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
  answerText: {
    color: '#1F1D19',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0,
    marginTop: 4,
  },
  answerTopLine: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  androidSafeArea: {
    paddingTop: Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 24 : 0,
  },
  aboutCopy: {
    color: '#2E3440',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 23,
    marginTop: 10,
    textAlign: 'center',
  },
  aboutHero: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 14,
    borderWidth: 2,
    padding: 22,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  aboutTitle: {
    color: '#1F2430',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 29,
    marginTop: 16,
    textAlign: 'center',
  },
  bodyText: {
    color: '#2E3440',
    fontSize: 16,
    lineHeight: 23,
    marginTop: 10,
  },
  boardAnswerCard: {
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    gap: 10,
    padding: 12,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  boardAnswerStack: {
    gap: 12,
    paddingBottom: 4,
    paddingTop: 14,
  },
  boardAnswerScroller: {
    maxHeight: 390,
  },
  boardAnswerTopLine: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  boardCategoryHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
  },
  boardCategoryPill: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 999,
    borderWidth: 2,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  boardCategoryText: {
    color: '#1F2430',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
  },
  boardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  boardHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  boardInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.86)',
    fontSize: 17,
    fontWeight: '900',
    minHeight: 52,
  },
  boardKicker: {
    color: '#FFE66D',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  boardLetterCopy: {
    flex: 1,
    gap: 8,
    minWidth: 0,
  },
  boardLetterHint: {
    color: '#D7DDE6',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 18,
  },
  boardLetterPanel: {
    alignItems: 'center',
    backgroundColor: '#24304A',
    borderColor: '#394867',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 14,
    marginTop: 18,
    padding: 14,
  },
  boardLetterText: {
    color: '#1F2430',
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 52,
  },
  boardLetterTile: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 14,
    borderWidth: 3,
    height: 78,
    justifyContent: 'center',
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    transform: [{ rotate: '-3deg' }],
    width: 78,
  },
  boardProgressFill: {
    backgroundColor: '#B8F7D4',
    borderRadius: 999,
    height: '100%',
  },
  boardProgressTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  boardProgressTrack: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 999,
    height: 9,
    overflow: 'hidden',
  },
  boardSectionMeta: {
    color: '#FFE66D',
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'right',
    textTransform: 'uppercase',
  },
  boardSectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  boardTimerPill: {
    alignItems: 'center',
    backgroundColor: '#FF4F5E',
    borderColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 6,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  boardTimerPillUrgent: {
    backgroundColor: '#D62828',
    borderColor: '#FFE66D',
  },
  boardTimerText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  roundTimerOverlayWrap: {
    alignItems: 'flex-end',
    position: 'absolute',
    right: 24,
    top: 52,
    zIndex: 30,
  },
  stickyRoundTimer: {
    alignItems: 'center',
    backgroundColor: '#24304A',
    borderColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#000000',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 0,
    zIndex: 5,
  },
  stickyRoundTimerLeft: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    minWidth: 0,
  },
  stickyRoundTimerLabel: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  stickyRoundTimerValue: {
    color: '#B8F7D4',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  stickyRoundTimerValueUrgent: {
    color: '#FFE66D',
  },
  floatingRoundTimerWrap: {
    bottom: 18,
    left: 16,
    position: 'absolute',
    right: 16,
    zIndex: 20,
  },
  floatingRoundTimer: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#24304A',
    borderColor: '#FFFFFF',
    borderRadius: 999,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'space-between',
    maxWidth: 420,
    minHeight: 46,
    paddingHorizontal: 14,
    shadowColor: '#000000',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 0,
    width: '100%',
  },
  floatingRoundTimerUrgent: {
    backgroundColor: '#D62828',
    borderColor: '#FFE66D',
  },
  boardTitle: {
    color: '#FFFFFF',
    fontSize: 31,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 35,
    marginTop: 3,
  },
  roundBoard: {
    backgroundColor: '#192236',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    padding: 16,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  botAnswerList: {
    gap: 8,
  },
  botAnswerCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
    padding: 8,
  },
  botAnswerCopy: {
    flexShrink: 1,
    minWidth: 0,
  },
  botAnswerName: {
    color: '#59627A',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  botAnswerPoints: {
    color: '#1F2430',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
  },
  botAnswerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  botAnswerText: {
    color: '#1F2430',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 2,
  },
  botPanel: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 12,
    padding: 14,
  },
  brandMark: {
    alignItems: 'center',
    backgroundColor: '#FF4F5E',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    height: 48,
    justifyContent: 'center',
    marginTop: 2,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: 56,
  },
  brandMarkText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0,
  },
  brandMedal: {
    alignItems: 'center',
    backgroundColor: '#FF4F5E',
    borderColor: '#1F2430',
    borderRadius: 44,
    borderWidth: 4,
    height: 88,
    justifyContent: 'center',
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: 88,
  },
  buttonPressed: {
    opacity: 0.78,
  },
  chip: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipText: {
    color: '#1F2430',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0,
  },
  chipUnselected: {
    opacity: 0.6,
  },
  codeInput: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
  },
  codeBadge: {
    alignItems: 'center',
    backgroundColor: '#1F2430',
    borderRadius: 10,
    minWidth: 76,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  codeBadgeLabel: {
    color: '#B8F7D4',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  codeBadgeText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  codeInviteText: {
    color: '#1F2430',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: 20,
    paddingBottom: 64,
  },
  webContent: {
    alignSelf: 'center',
    maxWidth: 1180,
    paddingHorizontal: 40,
    width: '100%',
  },
  dashboardCopy: {
    color: '#2E3440',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  dashboardLabel: {
    color: '#1F2430',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  dashboardStatus: {
    color: '#FF4F5E',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  dashboardTitle: {
    color: '#1F2430',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 31,
    marginTop: 12,
  },
  dashboardTopLine: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  disabledButton: {
    backgroundColor: '#8EA0AA',
  },
  disabledModeCard: {
    opacity: 0.55,
  },
  disputeButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 12,
  },
  disputeButtonActive: {
    backgroundColor: '#FFE66D',
  },
  disputedAnswerRow: {
    backgroundColor: '#FFE1E4',
    borderColor: '#B42318',
    borderWidth: 2,
  },
  disputeButtonText: {
    color: '#1F2430',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
  },
  disputeFocusActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },
  disputeFocusCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    gap: 10,
    padding: 12,
  },
  disputeResultText: {
    color: '#1F2430',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 4,
  },
  disputeSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    gap: 10,
    marginTop: 20,
    padding: 14,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  disputeSummaryRow: {
    alignItems: 'center',
    backgroundColor: '#F8F5EC',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    padding: 12,
  },
  targetFocusCard: {
    backgroundColor: '#E7F7FF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    gap: 5,
    marginTop: 12,
    padding: 12,
  },
  emptyAnswerText: {
    color: '#8A867D',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0,
    marginTop: 4,
  },
  eyebrow: {
    color: '#1F2430',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  errorText: {
    backgroundColor: '#FFF1F0',
    borderColor: '#F0B8B1',
    borderRadius: 8,
    borderWidth: 1,
    color: '#8A1F14',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 20,
    marginTop: 18,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fieldGroup: {
    gap: 8,
    marginTop: 24,
    width: '100%',
  },
  ghostButton: {
    alignItems: 'center',
    borderRadius: 8,
    minHeight: 52,
    justifyContent: 'center',
  },
  ghostButtonText: {
    color: '#1F2430',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  heading: {
    color: '#1F2430',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0,
  },
  helperText: {
    color: '#3E4A56',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 19,
    marginTop: 10,
  },
  markingFirstBlock: {
    marginTop: 18,
  },
  roundProgressText: {
    color: '#59627A',
    fontSize: 13,
    fontWeight: '900',
    marginTop: 5,
  },
  homeDashboard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    marginTop: 24,
    padding: 18,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  homeAvatarButton: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 22,
    borderWidth: 3,
    height: 58,
    justifyContent: 'center',
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: 58,
  },
  homeBrandButton: {
    alignItems: 'center',
    backgroundColor: '#FF4F5E',
    borderColor: '#1F2430',
    borderRadius: 18,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 36,
    minWidth: 44,
    paddingHorizontal: 9,
    shadowColor: '#1F2430',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  homeBrandButtonExpanded: {
    maxWidth: 190,
  },
  homeBrandText: {
    color: '#FFFFFF',
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  homeHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  homeHero: {
    backgroundColor: '#192236',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    gap: 16,
    marginTop: 18,
    overflow: 'hidden',
    padding: 18,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  homeHeroArtRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    zIndex: 1,
  },
  homeHeroBackdrop: {
    bottom: 0,
    left: 0,
    opacity: 0.24,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  homeHeroHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
    zIndex: 1,
  },
  homeHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  homeHeroFightLine: {
    color: '#D7DDE6',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 20,
    marginTop: 8,
  },
  homeHeroScrim: {
    bottom: 0,
    backgroundColor: 'rgba(25, 34, 54, 0.76)',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  homeHeroStat: {
    alignItems: 'center',
    flex: 1,
    gap: 3,
    justifyContent: 'center',
    minHeight: 50,
  },
  homeHeroStatDivider: {
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
    width: 1,
  },
  homeHeroStatLabel: {
    color: '#D7DDE6',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  homeHeroStats: {
    backgroundColor: 'rgba(255, 255, 255, 0.09)',
    borderColor: 'rgba(255, 255, 255, 0.18)',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  homeHeroStatValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
  },
  homeHeroSubtitle: {
    color: '#FFE66D',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 24,
    marginTop: 2,
  },
  homeHeroTile: {
    height: 46,
    transform: [{ rotate: '-2deg' }],
    width: 46,
  },
  homeHeroTileStack: {
    flex: 1,
    minWidth: 0,
  },
  homeHeroTitle: {
    color: '#FFFFFF',
    fontSize: 39,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 43,
    marginTop: 5,
  },
  homeKicker: {
    color: '#FFE66D',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  homeLogo: {
    height: 120,
    marginLeft: -6,
    marginTop: 6,
    maxWidth: 220,
    width: '100%',
  },
  homeMascotRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 118,
  },
  homeMascotArt: {
    height: 126,
    width: 104,
  },
  homeModeArt: {
    height: 58,
    width: 66,
  },
  homeModeCopy: {
    flex: 1,
    minWidth: 0,
  },
  homeModeIconPrimary: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 18,
    borderWidth: 2,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  homeModeIconSecondary: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 18,
    borderWidth: 2,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  homeModeMeta: {
    color: '#FFEDEB',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 18,
    marginTop: 3,
  },
  homeModeMetaDark: {
    color: '#344050',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 18,
    marginTop: 3,
  },
  homeModeStack: {
    gap: 12,
    marginTop: 18,
  },
  homeModeTitle: {
    color: '#FFFFFF',
    flexShrink: 1,
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 28,
  },
  homeModeTitleDark: {
    color: '#1F2430',
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 26,
  },
  homePrimaryModeCard: {
    alignItems: 'center',
    backgroundColor: '#FF4F5E',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    minHeight: 92,
    padding: 16,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  homePracticeModeCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    minHeight: 84,
    padding: 16,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  homeQuickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 18,
  },
  homeQuickTile: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexBasis: '47%',
    flexGrow: 1,
    gap: 8,
    minHeight: 76,
    justifyContent: 'center',
    padding: 12,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  homeQuickTitle: {
    color: '#1F2430',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
  },
  homeSecondaryModeCard: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    minHeight: 88,
    padding: 16,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  homeTitleRow: {
    alignItems: 'flex-start',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    paddingRight: 12,
  },
  homeTopBar: {
    alignItems: 'center',
    backgroundColor: '#192236',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    padding: 8,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  infoBox: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flex: 1,
    padding: 14,
  },
  infoGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 22,
  },
  infoLabel: {
    color: '#344050',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    marginBottom: 5,
    textTransform: 'uppercase',
  },
  infoValue: {
    color: '#1F2430',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0,
  },
  historyRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 10,
    padding: 14,
  },
  historyTitle: {
    color: '#214E9C',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  generalLeaderRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginBottom: 10,
    padding: 12,
  },
  generalLeaderRowActive: {
    backgroundColor: '#B8F7D4',
  },
  heroTile: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    height: 56,
    justifyContent: 'center',
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: 56,
  },
  heroTileText: {
    color: '#1F2430',
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    color: '#1F2430',
    fontSize: 16,
    minHeight: 54,
    paddingHorizontal: 14,
  },
  keyboardView: {
    flex: 1,
  },
  iconButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    height: 48,
    justifyContent: 'center',
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: 48,
  },
  iconButtonActive: {
    backgroundColor: '#FFE66D',
  },
  label: {
    color: '#1F2430',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0,
  },
  letterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  letterModeButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  letterModeButtonSelected: {
    backgroundColor: '#B8F7D4',
  },
  letterModeGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  letterPickButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  letterPickButtonSelected: {
    backgroundColor: '#FFE66D',
  },
  letterPickText: {
    color: '#1F2430',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  letterPickerCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    padding: 14,
  },
  leaderboardHero: {
    alignItems: 'center',
    backgroundColor: '#1F2430',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 22,
    padding: 18,
  },
  leaderName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 4,
  },
  leaderScore: {
    color: '#FFE66D',
    fontSize: 42,
    fontWeight: '900',
    letterSpacing: 0,
  },
  leagueHeroMeta: {
    color: '#D7DDE6',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    marginTop: 4,
  },
  leagueHeroTrophy: {
    alignItems: 'center',
    borderColor: '#FFFFFF',
    borderRadius: 34,
    borderWidth: 2,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  leaguePath: {
    gap: 10,
  },
  leagueStep: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  leagueStepCurrent: {
    borderWidth: 4,
  },
  leagueStepTitle: {
    color: '#1F2430',
    flex: 1,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  leagueSummaryCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    padding: 12,
  },
  leagueTrophy: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 24,
    borderWidth: 2,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  letterCard: {
    backgroundColor: '#F1EFE8',
    borderColor: '#DFDAD0',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 22,
    padding: 18,
  },
  letterText: {
    color: '#FF4F5E',
    fontSize: 78,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 4,
  },
  levelBadge: {
    alignItems: 'center',
    backgroundColor: '#B844E8',
    borderColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 4,
    marginTop: -20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  levelBadgeText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
  },
  lobbyHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
  },
  lobbyRosterAvatar: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 18,
    borderWidth: 2,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  privateWaitingPanel: {
    alignItems: 'center',
    backgroundColor: '#B8F7D4',
    borderColor: '#1F2430',
    borderRadius: 14,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
    padding: 16,
  },
  privateWaitingCopy: {
    flex: 1,
  },
  privateWaitingTitle: {
    color: '#1F2430',
    fontSize: 17,
    fontWeight: '900',
  },
  privateWaitingMeta: {
    color: '#2E3440',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 4,
  },
  lobbyCategoryList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  lobbyCategoryChip: {
    borderColor: '#1F2430',
    borderRadius: 999,
    borderWidth: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  lobbyCategoryChipText: {
    color: '#1F2430',
    fontSize: 12,
    fontWeight: '900',
  },
  lobbyRosterBadge: {
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 999,
    borderWidth: 1,
    color: '#1F2430',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    paddingHorizontal: 8,
    paddingVertical: 3,
    textTransform: 'uppercase',
  },
  lobbyRosterCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  lobbyRosterCopy: {
    flex: 1,
    minWidth: 0,
  },
  lobbyRosterList: {
    gap: 10,
    marginTop: 12,
  },
  lobbyRosterMeta: {
    color: '#3E4A56',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    marginTop: 3,
  },
  lobbyRosterName: {
    color: '#1F2430',
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  lobbyRosterNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  lobbyRosterScore: {
    alignItems: 'center',
    backgroundColor: '#192236',
    borderRadius: 10,
    minWidth: 54,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  lobbyRosterScoreLabel: {
    color: '#D7DDE6',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  lobbyRosterScoreValue: {
    color: '#FFE66D',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  lobbySettingsPanel: {
    marginTop: 14,
  },
  lobbySettingsToggle: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 18,
    padding: 14,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  inviteHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  inviteHeaderRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  creatorBadge: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 20,
    borderWidth: 2,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  creatorCopy: {
    flex: 1,
    minWidth: 0,
  },
  madeByCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    gap: 12,
    marginTop: 18,
    padding: 16,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  madeByRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  versionInfoRow: {
    alignItems: 'flex-start',
    borderTopColor: '#E1E5EA',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingTop: 10,
  },
  versionInfoValue: {
    color: '#1F2430',
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'right',
  },
  panel: {
    width: '100%',
  },
  webPanel: {
    alignSelf: 'center',
    maxWidth: 1080,
  },
  webScoringPanel: {
    maxWidth: 1100,
  },
  playerIdentityAvatar: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 48,
    borderWidth: 4,
    height: 96,
    justifyContent: 'center',
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: 96,
  },
  playerIdentityBlock: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 140,
    paddingTop: 12,
  },
  playerIdentityName: {
    color: '#1F2430',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 8,
    maxWidth: '90%',
  },
  modeCard: {
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    gap: 10,
    minHeight: 152,
    padding: 12,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: '48%',
  },
  modeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  modeDetailCopy: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 21,
    marginTop: 8,
    textAlign: 'center',
  },
  modeDetailHero: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 14,
    borderWidth: 2,
    padding: 20,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  modeDetailTitle: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 28,
    marginTop: 14,
    textAlign: 'center',
  },
  modeStatsGrid: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  modeIconBubble: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    borderColor: '#1F2430',
    borderRadius: 34,
    borderWidth: 2,
    height: 68,
    justifyContent: 'center',
    width: 68,
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(31, 36, 48, 0.56)',
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  matchResultCard: {
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    gap: 12,
    marginTop: 18,
    padding: 16,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  matchResultModal: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 14,
    borderWidth: 3,
    gap: 12,
    maxWidth: 360,
    padding: 22,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: '100%',
  },
  matchResultTitle: {
    color: '#1F2430',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 28,
  },
  leaveRoomModal: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 14,
    borderWidth: 3,
    gap: 12,
    maxWidth: 360,
    padding: 22,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: '100%',
  },
  letterPickerModal: {
    alignItems: 'stretch',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 14,
    borderWidth: 3,
    gap: 12,
    maxWidth: 390,
    padding: 18,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: '100%',
  },
  noticeStack: {
    alignSelf: 'stretch',
    gap: 8,
  },
  noticeStackCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    padding: 12,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  openRoomCard: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    marginTop: 16,
    padding: 14,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  openRoomIcon: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  openRoomTopButton: {
    backgroundColor: '#FFE66D',
  },
  scoringHelpModal: {
    alignItems: 'center',
    backgroundColor: '#B8F7D4',
    borderColor: '#1F2430',
    borderRadius: 14,
    borderWidth: 3,
    gap: 12,
    maxWidth: 360,
    padding: 22,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: '100%',
  },
  scoringStepList: {
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    gap: 6,
    padding: 12,
  },
  resultAchievementRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  resultAchievementText: {
    color: '#1F2430',
    flex: 1,
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 19,
  },
  resultGrid: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    gap: 10,
  },
  resultLabel: {
    color: '#344050',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  resultTile: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flex: 1,
    gap: 5,
    minHeight: 96,
    justifyContent: 'center',
    padding: 10,
  },
  resultValue: {
    color: '#1F2430',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
  },
  answerToolRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  factCheckButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#E7F7FF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  factCheckButtonText: {
    color: '#1F2430',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
  },
  factCheckSource: {
    color: '#344050',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  factCheckVerdict: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  factCheckVerdictVerified: {
    backgroundColor: '#B8F7D4',
  },
  factCheckVerdictInvalid: {
    backgroundColor: '#FFCCCA',
  },
  factCheckVerdictPossible: {
    backgroundColor: '#FFE66D',
  },
  factCheckVerdictTitle: {
    color: '#1F2430',
    fontSize: 15,
    fontWeight: '900',
  },
  factCheckVerdictCopy: {
    color: '#344050',
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
  reportButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFF1F0',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  reportButtonText: {
    color: '#1F2430',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
  },
  reportInput: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    color: '#1F2430',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0,
    lineHeight: 21,
    minHeight: 110,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    width: '100%',
  },
  miniAvatar: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 14,
    borderWidth: 2,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  modeMeta: {
    color: '#FFFFFF',
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 16,
    marginTop: 4,
  },
  modeTitle: {
    color: '#FFFFFF',
    flexShrink: 1,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 23,
  },
  navRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    padding: 16,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  optionGrid: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
  },
  checkboxBox: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 6,
    borderWidth: 2,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  checkboxBoxChecked: {
    backgroundColor: '#B8F7D4',
  },
  checkboxRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
    maxWidth: 350,
    padding: 14,
    width: '100%',
  },
  checkboxText: {
    color: '#1F2430',
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0,
  },
  opponentChallengeCard: {
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    padding: 10,
  },
  optionPill: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  optionPillSelected: {
    backgroundColor: '#FFE66D',
    borderWidth: 3,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  optionPillText: {
    color: '#1F2430',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0,
  },
  scorerOptionPill: {
    flex: 1,
    justifyContent: 'center',
    minHeight: 48,
  },
  scorerOptionPillSelected: {
    backgroundColor: '#1F2430',
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  scorerOptionPillText: {
    flexShrink: 1,
    textAlign: 'center',
  },
  scorerOptionPillTextSelected: {
    color: '#FFFFFF',
  },
  playerMeta: {
    color: '#3E4A56',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0,
    marginTop: 2,
  },
  playerName: {
    color: '#1F2430',
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 0,
  },
  playerRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#FF4F5E',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: 18,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  warningButton: {
    backgroundColor: '#F7B731',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  pointsText: {
    color: '#FF4F5E',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
  },
  pointsBadge: {
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    minWidth: 72,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pointsBadgeSmall: {
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    minWidth: 42,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  rankBadge: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 18,
    borderWidth: 2,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  rankBadgeText: {
    color: '#1F2430',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
  },
  randomLetterButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  randomLetterButtonSelected: {
    backgroundColor: '#B8F7D4',
  },
  randomLetterText: {
    color: '#1F2430',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0,
  },
  revealRow: {
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    gap: 14,
    marginBottom: 12,
    padding: 14,
  },
  revealTopLine: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  roundHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'space-between',
  },
  roomDashboard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    marginTop: 24,
    padding: 18,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  ruleRow: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 12,
    maxWidth: 350,
    minWidth: 0,
    padding: 14,
    width: '100%',
  },
  webRuleRow: {
    flexBasis: '47%',
    flexGrow: 0,
    maxWidth: 340,
    minHeight: 96,
    width: 'auto',
  },
  webRuleRowMobile: {
    flexBasis: '100%',
    maxWidth: 520,
  },
  webRuleText: {
    maxWidth: 360,
  },
  ruleText: {
    color: '#1F2430',
    flex: 1,
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 22,
    maxWidth: 260,
    minWidth: 0,
  },
  rulesCard: {
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    marginTop: 14,
    padding: 14,
  },
  rulesHero: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 14,
    borderWidth: 2,
    gap: 8,
    maxWidth: 350,
    padding: 22,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  webRulesHero: {
    flexBasis: 320,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'center',
    maxWidth: 360,
    padding: 32,
    width: 'auto',
  },
  webRulesHeroStacked: {
    maxWidth: 900,
    width: '100%',
  },
  rulesMain: {
    alignItems: 'center',
    width: '100%',
  },
  webRulesMain: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 24,
  },
  webRulesMainStacked: {
    flexDirection: 'column',
    gap: 0,
  },
  rulesList: {
    alignItems: 'stretch',
    gap: 10,
    marginTop: 24,
    maxWidth: 350,
    width: '100%',
  },
  webRulesList: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    justifyContent: 'center',
    maxWidth: 720,
  },
  webRulesListStacked: {
    flex: 0,
    maxWidth: 720,
    width: '100%',
  },
  webRulesPanel: {
    alignItems: 'center',
    maxWidth: 1120,
  },
  webCheckboxRow: {
    maxWidth: 900,
  },
  webActions: {
    alignSelf: 'center',
    maxWidth: 440,
  },
  roundActions: {
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 16,
    maxWidth: 760,
  },
  roundActionsCompact: {
    flexDirection: 'column',
    gap: 10,
    maxWidth: 350,
  },
  roundSubmitButton: {
    flex: 1,
  },
  roundQuitButton: {
    minWidth: 180,
  },
  secondaryButton: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    minHeight: 54,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  secondaryButtonText: {
    color: '#1F2430',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  scoreCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    marginTop: 20,
    padding: 16,
  },
  scorePill: {
    alignItems: 'center',
    backgroundColor: '#1F2430',
    borderRadius: 12,
    minWidth: 82,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scorePillLabel: {
    color: '#7BDFF2',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  scorePillText: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 0,
  },
  scoreText: {
    color: '#1F2430',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 2,
  },
  scoreToneBlank: {
    backgroundColor: '#E7EBF0',
  },
  scoreToneHalf: {
    backgroundColor: '#FFE66D',
  },
  scoreToneInvalid: {
    backgroundColor: '#FF9A8A',
  },
  scoreToneValid: {
    backgroundColor: '#B8F7D4',
  },
  scoreActionHalf: {
    backgroundColor: '#FFE66D',
  },
  scoreActionHalfSelected: {
    backgroundColor: '#E0B51D',
  },
  scoreActionInvalid: {
    backgroundColor: '#FF9A8A',
  },
  scoreActionInvalidSelected: {
    backgroundColor: '#E55A4F',
  },
  scoreActionValid: {
    backgroundColor: '#B8F7D4',
  },
  scoreActionValidSelected: {
    backgroundColor: '#42C47A',
  },
  scoreFocusAnswer: {
    color: '#1F2430',
    fontSize: 25,
    fontWeight: '900',
    letterSpacing: 0,
  },
  scoreFocusButton: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flex: 1,
    gap: 6,
    minHeight: 82,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  scoreFocusButtonGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  scoreFocusButtonSelected: {
    borderColor: '#1F2430',
    borderWidth: 4,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    transform: [{ translateY: -2 }],
  },
  scoreFocusButtonText: {
    color: '#1F2430',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
  },
  scoreFocusButtonTextSelected: {
    color: '#FFFFFF',
  },
  scoreFocusButtonDisabled: {
    opacity: 0.42,
  },
  scoreFocusCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 3,
    flex: 1,
    gap: 12,
    minWidth: 0,
    padding: 14,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  scoreFocusPlayer: {
    color: '#59627A',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  scoreFocusHint: {
    color: '#3E4A56',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 15,
    textTransform: 'uppercase',
  },
  scoreFocusNoAnswer: {
    color: '#8A1F14',
    fontSize: 23,
    fontWeight: '900',
    letterSpacing: 0,
  },
  scoreCardBodyRow: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  scoreCardBodyColumn: {
    flexDirection: 'column',
  },
  webScoreCardBodyRow: {
    alignSelf: 'stretch',
    gap: 18,
    width: '100%',
  },
  webScoreCardBodyColumn: {
    flexDirection: 'column',
  },
  scoreCompareAnswer: {
    color: '#1F2430',
    flex: 1,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 18,
    minWidth: 0,
    textAlign: 'right',
  },
  webScoreCompareAnswer: {
    textAlign: 'left',
  },
  scoreCompareEmpty: {
    color: '#59627A',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 17,
    marginTop: 8,
  },
  scoreCompareName: {
    color: '#59627A',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  scoreCompareNameBlock: {
    flexShrink: 0,
    width: 50,
  },
  scoreComparePane: {
    backgroundColor: 'rgba(255, 255, 255, 0.72)',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flex: 1,
    gap: 7,
    minWidth: 0,
    padding: 8,
  },
  webScoreComparePane: {
    flex: 0.8,
    padding: 18,
    width: 'auto',
  },
  webScorePaneStacked: {
    width: '100%',
  },
  scoreCompareRow: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 46,
    padding: 7,
  },
  scoreCompareRowMatch: {
    borderWidth: 3,
    shadowColor: '#1F2430',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  scoreCompareTitle: {
    color: '#1F2430',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  scoreDeckDot: {
    borderColor: '#1F2430',
    borderRadius: 999,
    borderWidth: 2,
    height: 12,
    opacity: 0.55,
    width: 12,
  },
  scoreDeckDotActive: {
    opacity: 1,
    transform: [{ scale: 1.25 }],
  },
  scoreDeckDotCompleted: {
    opacity: 0.9,
    transform: [{ scale: 0.88 }],
  },
  scoreDeckDots: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  scoreCarouselControls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center',
    marginTop: 10,
  },
  scoreCarouselArrow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
    minHeight: 38,
    paddingHorizontal: 4,
  },
  scoreCarouselArrowDisabled: {
    opacity: 0.3,
  },
  scoreCarouselArrowText: {
    color: '#1F2430',
    fontSize: 11,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  scoreDeckVoteButton: {
    minHeight: 54,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  webScoreDeckVoteButton: {
    minHeight: 132,
    paddingHorizontal: 12,
    paddingVertical: 14,
  },
  webScoreDeckVoteButtonMobile: {
    minHeight: 72,
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  scorePrimaryPane: {
    backgroundColor: 'rgba(255, 255, 255, 0.58)',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flex: 1,
    gap: 10,
    minWidth: 0,
    padding: 10,
  },
  scorePaneStacked: {
    width: '100%',
  },
  scorePaneHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  webScorePrimaryPane: {
    flex: 1,
    padding: 18,
    width: 'auto',
  },
  webSelectedAnswerLabel: {
    color: '#1F2430',
    fontSize: 16,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  scoreSideAnswer: {
    color: '#1F2430',
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 20,
    minWidth: 0,
    textAlign: 'right',
  },
  scoreSideCategory: {
    color: '#1F2430',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  scoreSideFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    justifyContent: 'space-between',
  },
  scoreSideHint: {
    color: '#59627A',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  scoreSideItem: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    gap: 5,
    minHeight: 86,
    padding: 8,
  },
  scoreSideItemActive: {
    borderWidth: 4,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  scoreSideName: {
    color: '#59627A',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  scoreSideLeft: {
    flexShrink: 0,
    maxWidth: 54,
    minWidth: 42,
  },
  scoreSideMainRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'space-between',
  },
  scoreSideRail: {
    gap: 8,
    width: 112,
  },
  scoreSideTitle: {
    color: '#1F2430',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  scoreSideVerdict: {
    color: '#1F2430',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0,
  },
  scoreSwipeCard: {
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 3,
    marginRight: 12,
    minHeight: 218,
    padding: 10,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: 316,
  },
  webScoreSwipeCard: {
    minHeight: 520,
    padding: 18,
    width: 980,
  },
  webScoreSwipeCardTablet: {
    minHeight: 640,
    padding: 16,
    width: 680,
  },
  webScoreSwipeCardMobile: {
    minHeight: 0,
    padding: 14,
    width: '100%',
  },
  scoreSwipeCardActive: {
    borderWidth: 4,
    transform: [{ translateY: -2 }],
  },
  scoreSwipeTrack: {
    paddingBottom: 8,
    paddingLeft: 2,
    paddingRight: 18,
    paddingTop: 6,
  },
  scoreSwipeWrap: {
    gap: 8,
    marginBottom: 16,
  },
  compactReviewShell: {
    gap: 14,
    marginTop: 14,
  },
  compactReviewColumns: {
    gap: 14,
  },
  compactReviewColumnsWide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  compactReviewList: {
    flex: 1,
    gap: 10,
    minWidth: 0,
  },
  compactReviewDetails: {
    flex: 0.78,
    minWidth: 280,
  },
  emptyDetails: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 16,
    borderWidth: 3,
    gap: 8,
    padding: 18,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  emptyDetailsTitle: {
    color: '#111B3A',
    fontSize: 18,
    fontWeight: '900',
  },
  emptyDetailsCopy: {
    color: '#59627A',
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 18,
  },
  reviewDetailsBackdrop: {
    backgroundColor: 'rgba(17, 27, 58, .42)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  reviewDetailsSheet: {
    backgroundColor: '#FFF1D6',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    gap: 8,
    maxHeight: '88%',
    padding: 14,
  },
  reviewDetailsClose: {
    alignSelf: 'flex-end',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 999,
    borderWidth: 2,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  reviewDetailsCloseText: {
    color: '#111B3A',
    fontSize: 12,
    fontWeight: '900',
  },
  scoreWorkbench: {
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 10,
  },
  scoringProgressCard: {
    backgroundColor: '#FFF3B8',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    gap: 7,
    marginTop: 18,
    padding: 14,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  scoringProgressFill: {
    backgroundColor: '#4ED17F',
    borderRadius: 999,
    height: '100%',
  },
  scoringProgressTrack: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 999,
    borderWidth: 2,
    height: 14,
    overflow: 'hidden',
  },
  phaseDeadlineCard: {
    backgroundColor: '#E7F3FF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    gap: 7,
    marginTop: 18,
    padding: 14,
  },
  phaseDeadlineCardComplete: {
    backgroundColor: '#D8F7C5',
  },
  phaseDeadlineCardError: {
    backgroundColor: '#FFD6D6',
  },
  phaseDeadlineCardExpired: {
    backgroundColor: '#FFE2B8',
  },
  phaseDeadlineValue: {
    color: '#111B3A',
    fontSize: 18,
    fontWeight: '900',
  },
  scoringHelpCard: {
    backgroundColor: '#B8F7D4',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    gap: 12,
    marginTop: 18,
    padding: 14,
  },
  reviewAnswerNameBlock: {
    flexShrink: 0,
    width: 74,
  },
  reviewAnswerPoints: {
    color: '#1F2430',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'right',
    width: 28,
  },
  reviewAnswerRow: {
    alignItems: 'center',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 8,
    minHeight: 58,
    padding: 8,
  },
  reviewAnswerStack: {
    gap: 8,
    marginTop: 10,
  },
  reviewAnswerText: {
    color: '#1F2430',
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 21,
    minWidth: 0,
    textAlign: 'right',
  },
  reviewStackCard: {
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 3,
    marginRight: 14,
    minHeight: 208,
    padding: 12,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    width: 252,
  },
  reviewStackCascade: {
    marginLeft: -8,
  },
  reviewStackTrack: {
    paddingBottom: 8,
    paddingLeft: 2,
    paddingRight: 18,
    paddingTop: 4,
  },
  reviewStackWrap: {
    gap: 8,
    marginBottom: 16,
  },
  section: {
    marginTop: 24,
    paddingTop: 20,
  },
  sectionHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionIntroText: {
    color: '#3E4A56',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    lineHeight: 19,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#1F2430',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0,
    marginBottom: 12,
  },
  screenTitleBlock: {
    flex: 1,
  },
  screenTopBar: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 14,
    marginBottom: 22,
  },
  screenTopBarCompact: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flex: 1,
    gap: 12,
  },
  settingRow: {
    alignItems: 'center',
    borderBottomColor: '#D7DDE6',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 16,
  },
  settingRowMain: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    gap: 12,
  },
  settingRowMeta: {
    color: '#3E4A56',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    marginTop: 2,
  },
  scoreReasonText: {
    backgroundColor: '#FFF7B8',
    borderColor: '#1F2430',
    borderRadius: 8,
    borderWidth: 1,
    color: '#1F2430',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    marginTop: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  settingRowTitle: {
    color: '#1F2430',
    flexShrink: 1,
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0,
  },
  settingsCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    paddingHorizontal: 16,
    shadowColor: '#1F2430',
    shadowOffset: { height: 4, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  shell: {
    backgroundColor: '#7BDFF2',
    flex: 1,
  },
  webShell: {
    minHeight: '100%',
  },
  smallActionButton: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: '#1F2430',
    borderRadius: 8,
    flexShrink: 0,
    flexDirection: 'row',
    gap: 6,
    height: 40,
    minHeight: 38,
    minWidth: 96,
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  smallActionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
  },
  smallToggleText: {
    color: '#1F2430',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  submittedCard: {
    backgroundColor: '#B8F7D4',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    marginTop: 20,
    padding: 16,
  },
  selfScorePanel: {
    gap: 8,
    marginTop: 12,
  },
  subtitle: {
    color: '#4A4A45',
    fontSize: 17,
    lineHeight: 24,
    marginTop: 12,
    maxWidth: 320,
  },
  statDivider: {
    backgroundColor: '#1F2430',
    width: 1,
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
  },
  statLabel: {
    color: '#344050',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  statStrip: {
    borderTopColor: '#1F2430',
    borderTopWidth: 2,
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
    paddingTop: 14,
  },
  statValue: {
    color: '#1F2430',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0,
  },
  stepper: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  stepperButton: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  stepperValue: {
    color: '#1F2430',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 0,
    minWidth: 20,
    textAlign: 'center',
  },
  searchCountdownValue: {
    color: '#D62828',
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 0,
    minWidth: 54,
    textAlign: 'center',
  },
  settingItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  settingText: {
    color: '#1F2430',
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0,
  },
  settingsTray: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 16,
    padding: 12,
  },
  setupSummaryCard: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    gap: 12,
    marginTop: 18,
    padding: 14,
  },
  setupSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  setupSummaryItem: {
    alignItems: 'center',
    backgroundColor: '#FFE66D',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 10,
    width: '48%',
  },
  setupSummaryMeta: {
    color: '#3E4A56',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
  },
  setupSummaryValue: {
    color: '#1F2430',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
  },
  themeCard: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    flexDirection: 'row',
    gap: 14,
    padding: 14,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  themeCardSelected: {
    backgroundColor: '#FFE66D',
  },
  themeCardText: {
    flex: 1,
  },
  themeList: {
    gap: 14,
  },
  themePreview: {
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flexDirection: 'row',
    height: 44,
    overflow: 'hidden',
    width: 72,
  },
  themeSwatch: {
    flex: 1,
  },
  toggleKnob: {
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 11,
    borderWidth: 2,
    height: 22,
    width: 22,
  },
  toggleKnobOn: {
    transform: [{ translateX: 22 }],
  },
  toggleTrack: {
    backgroundColor: '#D7DDE6',
    borderColor: '#1F2430',
    borderRadius: 14,
    borderWidth: 2,
    padding: 2,
    width: 52,
  },
  toggleTrackOn: {
    backgroundColor: '#B8F7D4',
  },
  title: {
    color: '#1F2430',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 38,
  },
  topIconButton: {
    alignItems: 'center',
    backgroundColor: '#24304A',
    borderRadius: 12,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  topStatPill: {
    alignItems: 'center',
    backgroundColor: '#24304A',
    borderColor: '#394867',
    borderRadius: 18,
    borderWidth: 2,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 36,
    paddingHorizontal: 8,
  },
  topStatText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: 0,
  },
  timerPill: {
    alignItems: 'center',
    backgroundColor: '#FF4F5E',
    borderColor: '#1F2430',
    borderRadius: 12,
    borderWidth: 2,
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 10,
    shadowColor: '#1F2430',
    shadowOffset: { height: 3, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
  },
  timerPillUrgent: {
    backgroundColor: '#D62828',
    borderColor: '#FFE66D',
  },
  timerText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 0,
  },
  tileBurst: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  verdictButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  verdictButtonDisabled: {
    opacity: 0.45,
  },
  verdictButtonSelected: {
    backgroundColor: '#1F2430',
    borderColor: '#1F2430',
  },
  verdictButtonText: {
    color: '#1F2430',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0,
    textTransform: 'capitalize',
  },
  verdictButtonTextSelected: {
    color: '#FFFFFF',
  },
  verdictRow: {
    flexDirection: 'row',
    gap: 8,
  },
  voteButton: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    flex: 1,
    flexDirection: 'column',
    gap: 4,
    justifyContent: 'center',
    minHeight: 62,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  voteButtonSelected: {
    borderColor: '#1F2430',
    borderWidth: 4,
    shadowColor: '#1F2430',
    shadowOffset: { height: 5, width: 0 },
    shadowOpacity: 1,
    shadowRadius: 0,
    transform: [{ translateY: -2 }],
  },
  voteButtonText: {
    color: '#1F2430',
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
  },
  voteLedger: {
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
    borderColor: '#1F2430',
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 8,
  },
  voteLedgerText: {
    color: '#1F2430',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0,
  },
  votePanel: {
    backgroundColor: 'rgba(255, 255, 255, 0.78)',
    borderColor: '#1F2430',
    borderRadius: 10,
    borderWidth: 2,
    gap: 8,
    padding: 12,
  },
  votePanelHighlighted: {
    backgroundColor: '#FFF7B8',
    borderWidth: 4,
  },
  reasonGrid: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  reasonChip: {
    backgroundColor: '#F8F5EC',
    borderColor: '#1F2430',
    borderRadius: 999,
    borderWidth: 2,
    minHeight: 38,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  reasonChipText: {
    color: '#1F2430',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
  },
  voteRow: {
    flexDirection: 'row',
    gap: 8,
    width: '100%',
  },
});
