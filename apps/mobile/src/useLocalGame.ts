import { REAL_PLAYER_WAIT_MS, remainingSearchMs, createSingleFlight } from './liveMatchmaking';
import { choosePersonalityWord, judgeAnswerFromEvidence } from './botStrategy';
import { pickRoundLetter, scoreAnswer, type AnswerVerdict } from '@animal-name-place/game-core';
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
  persistOnlineAnswerVote,
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
export type BotDifficulty = 'Easy' | 'Normal' | 'Hard';
export type BotPersonality =
  | 'Aggressive'
  | 'Agreeable'
  | 'Careful'
  | 'Chaotic'
  | 'Generous'
  | 'Perfect'
  | 'Scholar'
  | 'Skeptical'
  | 'Sloppy'
  | 'Speedy';
export type BotPlayer = {
  id: string;
  name: string;
  lastScore: number;
  personality: BotPersonality;
  totalScore: number;
};
export type BotRoundAnswer = {
  answer: string;
  botId: string;
  botName: string;
  category: StarterCategory;
  points: number;
  verdict: AnswerVerdict;
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
const BOT_DIFFICULTY_PROFILE: Record<BotDifficulty, { fillRate: number; typoRate: number; validRate: number }> = {
  Easy: { fillRate: 0.55, typoRate: 0.28, validRate: 0.58 },
  Normal: { fillRate: 0.82, typoRate: 0.1, validRate: 0.84 },
  Hard: { fillRate: 1, typoRate: 0.01, validRate: 0.97 },
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
const BOT_PERSONALITY_PROFILE: Record<BotPersonality, {
  challengeRateMultiplier: number;
  fillRateBoost: number;
  typoRateMultiplier: number;
  validRateBoost: number;
}> = {
  Aggressive: {
    challengeRateMultiplier: 1.7,
    fillRateBoost: 0.04,
    typoRateMultiplier: 0.8,
    validRateBoost: 0.02,
  },
  Agreeable: {
    challengeRateMultiplier: 0.35,
    fillRateBoost: 0,
    typoRateMultiplier: 0.9,
    validRateBoost: 0.03,
  },
  Careful: {
    challengeRateMultiplier: 1.05,
    fillRateBoost: -0.02,
    typoRateMultiplier: 0.35,
    validRateBoost: 0.12,
  },
  Chaotic: {
    challengeRateMultiplier: 1,
    fillRateBoost: -0.02,
    typoRateMultiplier: 1.8,
    validRateBoost: -0.08,
  },
  Generous: {
    challengeRateMultiplier: 0.25,
    fillRateBoost: 0,
    typoRateMultiplier: 0.9,
    validRateBoost: 0.07,
  },
  Sloppy: {
    challengeRateMultiplier: 0.85,
    fillRateBoost: -0.05,
    typoRateMultiplier: 2.6,
    validRateBoost: -0.14,
  },
  Perfect: {
    challengeRateMultiplier: 1.15,
    fillRateBoost: 0.08,
    typoRateMultiplier: 0,
    validRateBoost: 0.2,
  },
  Scholar: {
    challengeRateMultiplier: 1.25,
    fillRateBoost: 0.06,
    typoRateMultiplier: 0.2,
    validRateBoost: 0.16,
  },
  Skeptical: {
    challengeRateMultiplier: 1.45,
    fillRateBoost: 0.02,
    typoRateMultiplier: 0.7,
    validRateBoost: -0.03,
  },
  Speedy: {
    challengeRateMultiplier: 0.75,
    fillRateBoost: 0.1,
    typoRateMultiplier: 1.4,
    validRateBoost: -0.02,
  },
};

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

const BOT_WORD_BANK: Record<StarterCategory, string[]> = {
  Animal: [
    'Antelope', 'Bear', 'Cat', 'Dog', 'Eagle', 'Falcon', 'Goat', 'Horse', 'Iguana', 'Jaguar',
    'Koala', 'Lion', 'Monkey', 'Newt', 'Otter', 'Panda', 'Quail', 'Rabbit', 'Snake', 'Tiger',
    'Urial', 'Viper', 'Wolf', 'Xerus', 'Yak', 'Zebra',
    'Aardvark', 'Buffalo', 'Cheetah', 'Dolphin', 'Elephant', 'Fox', 'Giraffe', 'Hyena', 'Impala', 'Jackal',
    'Kangaroo', 'Leopard', 'Mongoose', 'Narwhal', 'Ostrich', 'Penguin', 'Quokka', 'Rhino', 'Shark', 'Tortoise',
    'Uakari', 'Vulture', 'Whale', 'Xenops', 'Yellowhammer', 'Zebu',
    'Alpaca', 'Baboon', 'Camel', 'Deer', 'Emu', 'Ferret', 'Gazelle', 'Hedgehog', 'Ibex', 'Jellyfish',
    'Kingfisher', 'Lemur', 'Meerkat', 'Numbat', 'Octopus', 'Peacock', 'Quetzal', 'Raccoon', 'Seal', 'Toucan',
    'Urchin', 'Vicuna', 'Walrus', 'Xolo', 'Yabby', 'Zorilla',
  ],
  Name: [
    'Alex', 'Bella', 'Caleb', 'Diana', 'Ethan', 'Fatima', 'Grace', 'Hassan', 'Isaac', 'Jade',
    'Kofi', 'Lola', 'Maya', 'Nadia', 'Omar', 'Peter', 'Queenie', 'Rita', 'Samuel', 'Tunde',
    'Uche', 'Victor', 'Wendy', 'Xavier', 'Yara', 'Zara',
    'Amina', 'Brian', 'Chika', 'Daniel', 'Esther', 'Femi', 'Gloria', 'Hannah', 'Ibrahim', 'James',
    'Kwame', 'Linda', 'Michael', 'Nana', 'Olivia', 'Priya', 'Quincy', 'Rachel', 'Sarah', 'Theo',
    'Uma', 'Vanessa', 'William', 'Ximena', 'Yusuf', 'Zainab',
    'Ada', 'Bola', 'Chioma', 'David', 'Ebere', 'Freya', 'George', 'Helen', 'Ife', 'Jonah',
    'Keisha', 'Luke', 'Malik', 'Naomi', 'Oscar', 'Paula', 'Quinn', 'Ruth', 'Sade', 'Tariq',
    'Uriel', 'Vera', 'Wale', 'Xena', 'Yemi', 'Zion', 'Joe',
  ],
  Place: [
    'Accra', 'Berlin', 'Cairo', 'Durban', 'Enugu', 'Florence', 'Ghana', 'Harare', 'Ibadan', 'Jakarta',
    'Kano', 'Lagos', 'Madrid', 'Nairobi', 'Oslo', 'Paris', 'Qatar', 'Rome', 'Seoul', 'Tokyo',
    'Uyo', 'Vienna', 'Warsaw', 'Xian', 'Yaounde', 'Zurich',
    'Abuja', 'Bradford', 'Cape Town', 'Dakar', 'Edinburgh', 'Freetown', 'Geneva', 'Houston', 'Istanbul', 'Johannesburg',
    'Kigali', 'London', 'Manchester', 'Naples', 'Oxford', 'Pretoria', 'Quebec', 'Rotterdam', 'Sydney', 'Toronto',
    'Uganda', 'Venice', 'Wembley', 'Xiamen', 'York', 'Zambia',
    'Athens', 'Bristol', 'Chicago', 'Delhi', 'Edo', 'Frankfurt', 'Gaborone', 'Helsinki', 'Ilorin', 'Kaduna',
    'Kyoto', 'Lisbon', 'Milan', 'New York', 'Orlando', 'Porto', 'Queens', 'Rwanda', 'Stockholm', 'Tripoli',
    'Utrecht', 'Valencia', 'Winnipeg', 'Xalapa', 'Yokohama', 'Zimbabwe',
  ],
  Brand: [
    'Apple', 'Bose', 'Canon', 'Disney', 'Ebay', 'Fanta', 'Google', 'Honda', 'Intel', 'Jeep',
    'Kia', 'Lego', 'Meta', 'Nike', 'Oppo', 'Pepsi', 'Quaker', 'Rolex', 'Samsung', 'Toyota',
    'Uber', 'Visa', 'Walmart', 'Xbox', 'Yamaha', 'Zara',
    'Adidas', 'Burger King', 'Coca Cola', 'Dell', 'Emirates', 'Ford', 'Gucci', 'HP', 'Instagram', 'Jordan',
    'KFC', 'LinkedIn', 'Mercedes', 'Netflix', 'Oracle', 'PlayStation', 'Qantas', 'Red Bull', 'Spotify', 'Tesla',
    'Under Armour', 'Vans', 'WhatsApp', 'Xiaomi', 'YouTube', 'Zoom',
    'Acer', 'Balenciaga', 'Cadbury', 'Dominos', 'Etsy', 'Fila', 'Glo', 'Huawei', 'Ikea', 'Jumia',
    'Kodak', 'Lacoste', 'Microsoft', 'Nvidia', 'Olympus', 'Prada', 'Qualcomm', 'Reebok', 'Shell', 'TikTok',
    'Unilever', 'Virgin', 'WordPress', 'Xfinity', 'Yelp', 'Zalando',
  ],
  Food: [
    'Apple', 'Bread', 'Cake', 'Donut', 'Egg', 'Fish', 'Gari', 'Honey', 'Icecream', 'Jollof',
    'Kebab', 'Lemon', 'Mango', 'Noodles', 'Okra', 'Pizza', 'Quiche', 'Rice', 'Soup', 'Taco',
    'Udon', 'Vanilla', 'Waffles', 'Xigua', 'Yam', 'Ziti',
    'Avocado', 'Beans', 'Chicken', 'Dumpling', 'Egusi', 'Falafel', 'Granola', 'Hotdog', 'Indomie', 'Jambalaya',
    'Kiwi', 'Lasagne', 'Moi Moi', 'Nachos', 'Oats', 'Pasta', 'Quesadilla', 'Ramen', 'Salad', 'Toast',
    'Ugba', 'Vegetables', 'Watermelon', 'Xacuti', 'Yoghurt', 'Zucchini',
    'Akara', 'Burger', 'Couscous', 'Dates', 'Eba', 'Fries', 'Grapes', 'Hummus', 'Idli', 'Jam',
    'Kale', 'Lentils', 'Meatballs', 'Nutmeg', 'Orange', 'Plantain', 'Quinoa', 'Risotto', 'Stew', 'Tuna',
    'Ukwa', 'Vindaloo', 'Wrap', 'Xnipec', 'Yassa', 'Zobo',
  ],
  Job: [
    'Artist', 'Baker', 'Chef', 'Doctor', 'Engineer', 'Farmer', 'Guard', 'Host', 'Inspector', 'Judge',
    'Keeper', 'Lawyer', 'Mechanic', 'Nurse', 'Officer', 'Pilot', 'Quartermaster', 'Ranger', 'Singer', 'Teacher',
    'Umpire', 'Vendor', 'Writer', 'Xylophonist', 'Youtuber', 'Zookeeper',
    'Accountant', 'Barber', 'Carpenter', 'Dentist', 'Electrician', 'Firefighter', 'Guide', 'Hairdresser', 'Illustrator', 'Journalist',
    'Knight', 'Lecturer', 'Manager', 'Nutritionist', 'Optician', 'Producer', 'Quality Inspector', 'Receptionist', 'Scientist', 'Tailor',
    'Usher', 'Vet', 'Waiter', 'Xray Technician', 'Yoga Instructor', 'Zoologist',
    'Actor', 'Banker', 'Courier', 'Designer', 'Editor', 'Florist', 'Geologist', 'Historian', 'Importer', 'Janitor',
    'Keyholder', 'Librarian', 'Musician', 'Novelist', 'Operator', 'Photographer', 'Quantity Surveyor', 'Researcher', 'Surgeon', 'Translator',
    'Undertaker', 'Videographer', 'Welder', 'Xray Operator', 'Youth Worker', 'Zumba Instructor',
  ],
  Object: [
    'Apple', 'Book', 'Chair', 'Drum', 'Envelope', 'Fork', 'Guitar', 'Hammer', 'Ink', 'Jacket',
    'Kettle', 'Lamp', 'Mirror', 'Notebook', 'Orange', 'Phone', 'Quilt', 'Radio', 'Spoon', 'Table',
    'Umbrella', 'Violin', 'Wallet', 'Xbox', 'Yarn', 'Zip',
    'Anchor', 'Bottle', 'Camera', 'Door', 'Eraser', 'Flag', 'Glasses', 'Helmet', 'Iron', 'Jar',
    'Key', 'Laptop', 'Microphone', 'Needle', 'Oven', 'Pencil', 'Queue Ticket', 'Remote', 'Suitcase', 'Torch',
    'Uniform', 'Vase', 'Watch', 'Xylophone', 'Yo-yo', 'Zipper',
    'Arrow', 'Basket', 'Candle', 'Desk', 'Earphones', 'Fan', 'Globe', 'Hat', 'Icebox', 'Jug',
    'Knife', 'Ladder', 'Mug', 'Net', 'Oil Lamp', 'Plate', 'Quartz', 'Ring', 'Scissors', 'Towel',
    'USB', 'Vacuum', 'Whistle', 'Xerox', 'Yoyo', 'Ziplock',
  ],
};

type AnswersByCategory = Record<StarterCategory, string>;
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

function pickBotAnswer(category: StarterCategory, letter: string, personality: BotPersonality) {
  const options = BOT_WORD_BANK[category].filter((word) => word.toUpperCase().startsWith(letter));

  if (!options.length) {
    return '';
  }

  return choosePersonalityWord(options, personality);
}

function normalizeAnswer(answer: string) {
  return answer.trim().toUpperCase().replace(/\s+/g, ' ');
}

export function getKnownCategoriesForAnswer(answer: string) {
  const normalizedAnswer = normalizeAnswer(answer);

  if (!normalizedAnswer) {
    return [] as StarterCategory[];
  }

  return STARTER_CATEGORIES.filter((category) => (
    BOT_WORD_BANK[category].some((word) => normalizeAnswer(word) === normalizedAnswer)
  ));
}

function createAnonymousName() {
  return `Anonymous${Math.floor(100 + Math.random() * 900)}`;
}

function createTypo(answer: string) {
  if (answer.length < 4) {
    return `${answer}${answer.at(-1) ?? ''}`;
  }

  const typoIndex = Math.max(1, Math.floor(Math.random() * answer.length));
  const typoType = Math.floor(Math.random() * 3);

  if (typoType === 0) {
    return `${answer.slice(0, typoIndex)}${answer.slice(typoIndex + 1)}`;
  }

  if (typoType === 1) {
    return `${answer.slice(0, typoIndex)}${answer[typoIndex]}${answer.slice(typoIndex)}`;
  }

  if (typoIndex >= answer.length - 1) {
    return `${answer}${answer.at(-1) ?? ''}`;
  }

  return `${answer.slice(0, typoIndex)}${answer[typoIndex + 1]}${answer[typoIndex]}${answer.slice(typoIndex + 2)}`;
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

function clampRate(value: number) {
  return Math.max(0, Math.min(1, value));
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

function createBotRoundAnswers(
  botCount: number,
  botNames: readonly string[],
  botPersonalities: readonly BotPersonality[],
  categories: readonly StarterCategory[],
  difficulty: BotDifficulty,
  letter: string,
): BotRoundAnswer[] {
  const profile = BOT_DIFFICULTY_PROFILE[difficulty];

  return Array.from({ length: botCount }).flatMap((_, botIndex) => (
    categories.map((category) => {
      const botId = `bot-${botIndex + 1}`;
      const botName = botNames[botIndex] ?? `CPU ${botIndex + 1}`;
      const personalityProfile = BOT_PERSONALITY_PROFILE[botPersonalities[botIndex] ?? 'Agreeable'];
      const fillRate = clampRate(profile.fillRate + personalityProfile.fillRateBoost);
      const typoRate = clampRate(profile.typoRate * personalityProfile.typoRateMultiplier);

      if (Math.random() > fillRate) {
        return {
          answer: '',
          botId,
          botName,
          category,
          points: 0,
          verdict: 'blank' as const,
        };
      }

      const cleanAnswer = pickBotAnswer(category, letter, botPersonalities[botIndex] ?? 'Agreeable');
      const hasTypo = Boolean(cleanAnswer) && Math.random() <= typoRate;
      const answer = hasTypo ? createTypo(cleanAnswer) : cleanAnswer;
      const verdict: AnswerVerdict = 'blank';

      return {
        answer,
        botId,
        botName,
        category,
        points: scoreAnswer({ verdict }),
        verdict,
      };
    })
  ));
}

function markDuplicateBotAnswers(
  botAnswers: readonly BotRoundAnswer[],
  playerAnswers: AnswersByCategory,
  categories: readonly StarterCategory[],
) {
  const duplicateKeys = new Set<string>();

  categories.forEach((category) => {
    const answerGroups = new Map<string, string[]>();
    const playerAnswer = normalizeAnswer(playerAnswers[category]);

    if (playerAnswer) {
      answerGroups.set(playerAnswer, ['player']);
    }

    botAnswers
      .filter((botAnswer) => botAnswer.category === category && botAnswer.answer.trim())
      .forEach((botAnswer) => {
        const normalizedAnswer = normalizeAnswer(botAnswer.answer);
        const key = `${botAnswer.botId}:${category}`;
        answerGroups.set(normalizedAnswer, [...(answerGroups.get(normalizedAnswer) ?? []), key]);
      });

    answerGroups.forEach((owners) => {
      if (owners.length > 1) {
        owners.filter((owner) => owner !== 'player').forEach((owner) => duplicateKeys.add(owner));
      }
    });
  });

  return botAnswers.map((botAnswer) => {
    if (!duplicateKeys.has(`${botAnswer.botId}:${botAnswer.category}`)) {
      return botAnswer;
    }

    return botAnswer.verdict === 'blank'
      ? botAnswer
      : {
        ...botAnswer,
        points: scoreAnswer({ verdict: 'duplicate' }),
        verdict: 'duplicate' as const,
      };
  });
}

function scoreBotOwnAnswers(
  botAnswers: readonly BotRoundAnswer[],
  letter: string,
  scoringStyle: ScoringStyle,
) {
  return botAnswers.map((botAnswer) => {
    const answer = botAnswer.answer.trim();

    if (!answer || botAnswer.verdict !== 'blank') {
      return botAnswer;
    }

    let verdict: AnswerVerdict = 'variant';

    if (scoringStyle === 'Strict' && letter && !answer.toUpperCase().startsWith(letter)) {
      verdict = 'invalid';
    } else if (getKnownCategoriesForAnswer(answer).includes(botAnswer.category)) {
      verdict = 'valid';
    }

    return {
      ...botAnswer,
      points: scoreAnswer({ verdict }),
      verdict,
    };
  });
}

function scoreBotRoundAnswers(botCount: number, answers: readonly BotRoundAnswer[]) {
  return Array.from({ length: botCount }, (_, botIndex) => {
    const botId = `bot-${botIndex + 1}`;
    return answers
      .filter((answer) => answer.botId === botId)
      .reduce((total, answer) => total + answer.points, 0);
  });
}

export function useLocalGame() {
  const draftSaveTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const roundSubmissionRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const timeoutFinalizationRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
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
  const liveAdvanceInFlight = useRef(false);
  const liveRetryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveBrawlInFlight = useRef(false);
  const editSnapshotRef = useRef<OnlineRoomSettings | null>(null);
  const [isEditingBrawl, setIsEditingBrawl] = useState(false);
  const [isSavingBrawl, setIsSavingBrawl] = useState(false);
  const [currentRound, setCurrentRound] = useState<CurrentRound>(null);
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

  const cleanedRoomCode = useMemo(() => roomCodeInput.trim().toUpperCase(), [roomCodeInput]);
  const answeredCount = useMemo(
    () => selectedCategories.filter((category) => answers[category].trim()).length,
    [answers, selectedCategories],
  );
  const totalScore = useMemo(
    () => selectedCategories.reduce((score, category) => score + scoreAnswer({ verdict: verdicts[category] }), 0),
    [selectedCategories, verdicts],
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

    Promise.all([
      AsyncStorage.getItem(RULES_SEEN_STORAGE_KEY),
      AsyncStorage.getItem(PLAYER_NAME_STORAGE_KEY),
    ])
      .then(async ([rulesSeen, storedPlayerName]) => {
        const cleanStoredName = storedPlayerName?.trim() ?? '';

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
          setScreen(cleanStoredName ? 'home' : 'nameSetup');
        }
      })
      .catch(() => {
        if (isMounted) {
          setScreen('rules');
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

    async function syncRoomState() {
      if (!room?.id) {
        return;
      }

      try {
        const snapshot = await getOnlineRoomSnapshot(room.id, room.playerId);

        if (!isMounted) {
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

        const restoredAnswers = room.playerId
          ? await getOnlinePlayerAnswers(snapshot.activeRound.id, room.playerId)
          : {};
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
        if (isMounted) {
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

    async function syncRevealSnapshot() {
      if (!room?.id || !currentRound?.id) {
        return;
      }

      try {
        const snapshot = await getOnlineRevealSnapshot(room.id, currentRound.id);

        if (!isMounted) {
          return;
        }

        setOnlineRevealAnswers(snapshot.answers);
        if (room.visibility === 'public' && (snapshot.submittedPlayerCount >= snapshot.activePlayerCount || timeRemaining <= 0)) {
          const botSnapshot = await getOnlineBotRoundSnapshot(room.id, currentRound.id);
          if (!isMounted) return;
          applyOnlineBotSnapshot(botSnapshot);
        }
        if (
          screen === 'leaderboard'
          || Date.now() - lastOnlineMatchSyncAtRef.current >= MATCH_STATE_SYNC_INTERVAL_MS
        ) {
          lastOnlineMatchSyncAtRef.current = Date.now();
          await syncOnlineMatchState();
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
        if (isMounted) {
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

  async function syncOnlineMatchState() {
    if (!room?.isOnline || !room.id || !room.playerId) {
      return {
        history: [] as OnlinePlayerRoundSummary[],
        standings: [] as OnlineMatchStanding[],
      };
    }

    const [nextStandings, nextRoundHistory] = await Promise.all([
      getOnlineMatchStandings(room.id),
      getOnlinePlayerRoundHistory(room.id, room.playerId),
    ]);

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

    return {
      history: nextRoundHistory,
      standings: nextStandings,
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

    setIsRoomBusy(true);
    setRoomError('');

    try {
      const onlineRoom = await joinOnlineRoom(cleanedRoomCode, name);
      const activeRound = await getOnlineRoomSnapshot(onlineRoom.id, onlineRoom.playerId)
        .then((snapshot) => snapshot.activeRound);
      const restoredAnswers = activeRound
        ? await getOnlinePlayerAnswers(activeRound.id, onlineRoom.playerId)
        : {};

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
      setRoomError(error instanceof Error ? error.message : 'Could not join session.');
    } finally {
      setIsRoomBusy(false);
    }
  }

  async function leaveRoom() {
    editSnapshotRef.current = null;
    setIsEditingBrawl(false);
    const roomToLeave = room;
    matchGenerationRef.current += 1;
    roundSubmissionRef.current = null;
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

  async function resetMatch() {
    editSnapshotRef.current = null;
    setIsEditingBrawl(false);
    const previousRoom = room;
    const shouldCreateFreshOnlineRoom = Boolean(previousRoom?.isOnline);
    const resetGeneration = ++matchGenerationRef.current;
    roundSubmissionRef.current = null;
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
    setOnlineMatchStandings([]);
    setOnlinePlayerRoundHistory([]);
    setOnlineRoundScores([]);
    setOnlineRoundAgreement(EMPTY_ONLINE_ROUND_AGREEMENT);
    setMatchStartedAtMs(null);
    setMatchTimeRemaining(matchDurationSeconds ?? 0);
    setLastMatchResult(null);

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
      setRoomError(error instanceof Error ? error.message : 'Could not start round.');
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

    const timeoutKey = currentRound.id;
    const existingFinalization = timeoutFinalizationRef.current;

    if (existingFinalization?.key === timeoutKey) {
      return existingFinalization.promise;
    }

    const finalization = (async () => {
      setIsRoundBusy(true);
      setRoomError('');

      try {
        const result = await finalizeOnlineRoundTimeout({
          playerId: room.playerId!,
          roomId: room.id!,
          roundId: currentRound.id,
        });
        emitQaTelemetry('client.timeout-finalized', {
          duplicate: result.duplicate,
          phase: result.phase,
          revision: result.revision,
          roomId: room.id,
          roundId: currentRound.id,
        });

        const snapshot = await getOnlineRevealSnapshot(room.id!, currentRound.id);
        setOnlineRevealAnswers(snapshot.answers);
        setOnlineRoundScores(snapshot.scores);
        setOnlineRoundAgreement(getOnlineRoundAgreement(snapshot));
        setRoundSubmitted(true);
        setScreen('reveal');
      } catch (error) {
        setRoomError(error instanceof Error ? error.message : 'Could not finalise timed-out round.');
        debugGameError('round-timeout-finalize-failed', error, { roundId: currentRound.id });
      } finally {
        setIsRoundBusy(false);
      }
    })();

    timeoutFinalizationRef.current = { key: timeoutKey, promise: finalization };

    try {
      await finalization;
    } finally {
      if (timeoutFinalizationRef.current?.key === timeoutKey) {
        timeoutFinalizationRef.current = null;
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

        if (room?.isOnline && currentRound?.id && room.id && room.playerId) {
          const playerId = room.playerId;
          const selectedAnswers = Object.fromEntries(
            selectedCategories.map((category) => [category, answers[category]]),
          ) as Partial<AnswersByCategory>;

          await submitOnlineAnswers({
            answers: selectedAnswers,
            playerId,
            roomId: room.id,
            roundId: currentRound.id,
          });

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
        setRoomError(error instanceof Error ? error.message : 'Could not submit answers.');
        debugGameError('round-submit-failed', error, { roundId: currentRound?.id });
      } finally {
        setIsRoundBusy(false);
      }
    })();

    roundSubmissionRef.current = { key: submissionKey, promise: submission };

    try {
      await submission;
    } finally {
      if (roundSubmissionRef.current?.promise === submission) {
        roundSubmissionRef.current = null;
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

  function persistCategoryVote(category: StarterCategory, vote: OnlineVoteVerdict, finalVerdict: OnlineVoteVerdict) {
    if (!room?.isOnline || !currentRound?.id || !room.playerId) {
      return;
    }
    if (isOnlinePhaseExpired('scoring')) {
      setRoomError('Scoring deadline expired. Syncing the server result.');
      void finalizeTimedOutRound();
      return;
    }

    persistOnlineAnswerVote({
      answerOwnerPlayerId: room.playerId,
      category,
      finalVerdict,
      roundId: currentRound.id,
      vote,
      voterPlayerId: room.playerId,
    }).catch((error) => {
      setRoomError(error instanceof Error ? error.message : 'Could not save vote.');
    });
  }

  function persistSyncedAnswerVote(answer: OnlineRevealAnswer, vote: OnlineVoteVerdict, finalVerdict: OnlineVoteVerdict) {
    if (!room?.isOnline || !currentRound?.id || !room.playerId) {
      return;
    }
    if (isOnlinePhaseExpired('scoring')) {
      setRoomError('Scoring deadline expired. Syncing the server result.');
      void finalizeTimedOutRound();
      return;
    }

    persistOnlineAnswerVoteById({
      answerId: answer.id,
      answerOwnerPlayerId: answer.playerId,
      finalVerdict,
      roundId: currentRound.id,
      vote,
      voterPlayerId: room.playerId,
    }).catch((error) => {
      setRoomError(error instanceof Error ? error.message : 'Could not save vote.');
    });
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

    try {
      await openOnlineAnswerDispute({
        answerId: answer.id,
        openedByPlayerId: room.playerId,
        roomId: room.id,
        roundId: currentRound.id,
      });

      const snapshot = await getOnlineRevealSnapshot(room.id, currentRound.id);
      setOnlineRevealAnswers(snapshot.answers);
      setOnlineRoundScores(snapshot.scores);
      setOnlineRoundAgreement(getOnlineRoundAgreement(snapshot));
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not open dispute.');
    }
  }

  async function persistSyncedDisputeVote(disputeId: string, vote: OnlineVoteVerdict) {
    if (!room?.isOnline || !room.id || !currentRound?.id || !room.playerId) {
      return;
    }
    if (isOnlinePhaseExpired('dispute')) {
      setRoomError('Dispute deadline expired. Syncing the server result.');
      void finalizeTimedOutRound();
      return;
    }

    try {
      await persistOnlineDisputeVote({
        disputeId,
        roundId: currentRound.id,
        roomId: room.id,
        verdict: vote,
        voterPlayerId: room.playerId,
      });

      // Pull the authoritative answer, dispute, and round-score state now;
      // do not make the player wait for the next polling tick.
      const snapshot = await getOnlineRevealSnapshot(room.id, currentRound.id);
      setOnlineRevealAnswers(snapshot.answers);
      setOnlineRoundScores(snapshot.scores);
      setOnlineRoundAgreement(getOnlineRoundAgreement(snapshot));
      await syncOnlineMatchState();
    } catch (error) {
      setRoomError(error instanceof Error ? error.message : 'Could not save dispute vote.');
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

    if (room?.isOnline && currentRound?.id && room.id && room.playerId) {
      setIsRoundBusy(true);
      setRoomError('');

      try {
        if (room.visibility === 'public' && !botRoundAnswers.length) {
          serverBotSnapshot = await getOnlineBotRoundSnapshot(room.id, currentRound.id);
          applyOnlineBotSnapshot(serverBotSnapshot);
        }
        await completeOnlineRound({
          finishMatch: willCompleteMatch,
          playerId: room.playerId,
          roomId: room.id,
          roundId: currentRound.id,
        });
        const syncedMatchState = await syncOnlineMatchState();
        syncedOnlineStandings = syncedMatchState.standings;
        syncedOnlinePlayerStanding = syncedMatchState.standings.find((standing) => (
          standing.playerId === room.playerId
        ));
      } catch (error) {
        setRoomError(error instanceof Error ? error.message : 'Could not finish round.');
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
    const nextPlayerProfile = {
      allTimePoints: playerProfile.allTimePoints + playerRoundScore,
      avatarKey: playerProfile.avatarKey,
      bestStreak: Math.max(playerProfile.bestStreak, nextStreak),
      currentStreak: nextStreak,
      gamesPlayed: playerProfile.gamesPlayed + 1,
      recentMatches: willCompleteMatch
        ? [nextMatchRecord, ...playerProfile.recentMatches].slice(0, 5)
        : playerProfile.recentMatches,
    };

    setLocalMatchStandings(nextStandings);
    setLastMatchResult({
      achievementUnlockedLabels: getNewAchievementLabels(playerProfile, nextPlayerProfile),
      isWinner: playerRank === 1,
      playerRank,
      playerScore: playerMatchScore,
      pointsEarned: playerRoundScore,
      totalPlayers: nextStandings.length,
    });
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
    onlineMatchStandings,
    onlinePlayerRoundHistory,
    onlineRoundAgreement,
    onlineRoundScores,
    finishNameSetup,
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
