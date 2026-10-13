import {
  calculateInvalidStreakPenalty,
  getAnswerOutcome,
  scoreAnswer,
  scoreOutcome,
  type AnswerOutcome,
  type AnswerVerdict,
} from './scoring';

export type MatchPhase =
  | 'lobby'
  | 'answering'
  | 'reveal'
  | 'scoring'
  | 'leaderboard'
  | 'finished';

export type MatchPlayer = {
  id: string;
  name: string;
  score: number;
  invalidStreak: number;
};

export type MatchRules = {
  rulesetVersion: number;
  modeId: string;
  maxPlayers: number;
  scores: Record<AnswerVerdict, number>;
  outcomeScores: Record<AnswerOutcome, number>;
  penaltiesEnabled: boolean;
  invalidStreakThreshold: number;
  invalidStreakPenalty: number;
};

export const DEFAULT_MATCH_RULES: MatchRules = {
  rulesetVersion: 1,
  modeId: 'classic',
  maxPlayers: 8,
  scores: {
    valid: 10,
    duplicate: 5,
    variant: 5,
    invalid: 0,
    blank: 0,
    disputed: 0,
  },
  outcomeScores: {
    unique: 10,
    shared: 5,
    no_score: 0,
  },
  penaltiesEnabled: false,
  invalidStreakThreshold: 3,
  invalidStreakPenalty: 5,
};

export type MatchAnswer = {
  playerId: string;
  category: string;
  text: string;
};

export type MatchVerdict = {
  playerId: string;
  category: string;
  verdict: AnswerVerdict;
};

export type RoundScoreBreakdown = {
  playerId: string;
  answerPoints: number;
  penaltyPoints: number;
  totalPoints: number;
  invalidStreak: number;
};

export type MatchRound = {
  number: number;
  letter: string;
  answers: MatchAnswer[];
  verdicts: MatchVerdict[];
  scores: RoundScoreBreakdown[];
};

export type MatchState = {
  schemaVersion: 1;
  matchId: string;
  revision: number;
  rules: MatchRules;
  phase: MatchPhase;
  roundNumber: number;
  totalRounds: number;
  categories: string[];
  roundSeconds: number;
  letter: string | null;
  players: MatchPlayer[];
  answers: MatchAnswer[];
  verdicts: MatchVerdict[];
  currentRoundScores: RoundScoreBreakdown[];
  history: MatchRound[];
};

export type MatchAction =
  | { type: 'start_match'; letter: string }
  | { type: 'submit_answers'; playerId: string; answers: Record<string, string> }
  | { type: 'open_reveal' }
  | { type: 'open_scoring' }
  | { type: 'set_verdict'; playerId: string; category: string; verdict: AnswerVerdict }
  | { type: 'complete_scoring' }
  | { type: 'start_next_round'; letter: string }
  | { type: 'finish_match' };

export type CreateMatchInput = {
  matchId?: string;
  rules?: Partial<MatchRules>;
  categories: readonly string[];
  roundSeconds: number;
  totalRounds: number;
  players: readonly Pick<MatchPlayer, 'id' | 'name'>[];
};

function cleanLetter(letter: string): string {
  const value = letter.trim().toUpperCase();

  if (!/^[A-Z]$/.test(value)) {
    throw new Error('A round must have exactly one A-Z letter.');
  }

  return value;
}

function requirePhase(state: MatchState, ...phases: MatchPhase[]) {
  if (!phases.includes(state.phase)) {
    throw new Error(`Cannot perform this action during ${state.phase}.`);
  }
}

function requirePlayer(state: MatchState, playerId: string) {
  if (!state.players.some((player) => player.id === playerId)) {
    throw new Error(`Unknown player: ${playerId}.`);
  }
}

function requireCategory(state: MatchState, category: string) {
  if (!state.categories.includes(category)) {
    throw new Error(`Unknown category: ${category}.`);
  }
}

function answerKey(playerId: string, category: string) {
  return `${playerId}:${category}`;
}

function getAnswer(state: MatchState, playerId: string, category: string): MatchAnswer | undefined {
  return state.answers.find((answer) => answerKey(answer.playerId, answer.category) === answerKey(playerId, category));
}

function getVerdict(state: MatchState, playerId: string, category: string): AnswerVerdict {
  return state.verdicts.find(
    (verdict) => answerKey(verdict.playerId, verdict.category) === answerKey(playerId, category),
  )?.verdict ?? 'blank';
}

export function createMatch(input: CreateMatchInput): MatchState {
  if (input.categories.length === 0) {
    throw new Error('A match needs at least one category.');
  }

  if (input.totalRounds < 1 || input.roundSeconds < 1) {
    throw new Error('A match needs positive round and timer limits.');
  }

  if (input.players.length < 1) {
    throw new Error('A match needs at least one player.');
  }

  const rules: MatchRules = {
    ...DEFAULT_MATCH_RULES,
    ...input.rules,
    scores: { ...DEFAULT_MATCH_RULES.scores, ...input.rules?.scores },
    outcomeScores: {
      ...DEFAULT_MATCH_RULES.outcomeScores,
      ...(input.rules?.scores
        ? {
            unique: input.rules.scores.valid,
            shared: input.rules.scores.duplicate,
          }
        : {}),
      ...input.rules?.outcomeScores,
    },
  };

  if (input.players.length > rules.maxPlayers) {
    throw new Error(`A match cannot have more than ${rules.maxPlayers} players.`);
  }

  const playerIds = new Set<string>();
  const players = input.players.map((player) => {
    if (playerIds.has(player.id)) {
      throw new Error(`Duplicate player: ${player.id}.`);
    }

    playerIds.add(player.id);
    return { ...player, score: 0, invalidStreak: 0 };
  });

  return {
    schemaVersion: 1,
    matchId: input.matchId ?? 'local-match',
    revision: 0,
    rules,
    phase: 'lobby',
    roundNumber: 0,
    totalRounds: input.totalRounds,
    categories: [...input.categories],
    roundSeconds: input.roundSeconds,
    letter: null,
    players,
    answers: [],
    verdicts: [],
    currentRoundScores: [],
    history: [],
  };
}

export function calculateRoundScores(
  state: Pick<MatchState, 'categories' | 'players' | 'answers' | 'verdicts'> & { rules?: MatchRules },
): RoundScoreBreakdown[] {
  return state.players.map((player) => {
    let answerPoints = 0;
    let invalidStreak = player.invalidStreak;

    for (const category of state.categories) {
      const answer = getAnswer(state as MatchState, player.id, category);
      const verdict = getVerdict(state as MatchState, player.id, category);

      if (!answer?.text.trim()) {
        invalidStreak = 0;
        continue;
      }

      const outcome = getAnswerOutcome(verdict);
      answerPoints += state.rules?.outcomeScores[outcome] ?? state.rules?.scores[verdict] ?? scoreOutcome(outcome) ?? scoreAnswer({ verdict });
      invalidStreak = verdict === 'invalid' ? invalidStreak + 1 : 0;
    }

    const penaltyPoints = state.rules?.penaltiesEnabled
      ? calculateInvalidStreakPenalty({
          invalidStreak,
          threshold: state.rules.invalidStreakThreshold,
          penaltyPoints: state.rules.invalidStreakPenalty,
        })
      : 0;

    return {
      playerId: player.id,
      answerPoints,
      penaltyPoints,
      totalPoints: answerPoints + penaltyPoints,
      invalidStreak,
    };
  });
}

export function reduceMatch(state: MatchState, action: MatchAction): MatchState {
  switch (action.type) {
    case 'start_match': {
      requirePhase(state, 'lobby');
      const letter = cleanLetter(action.letter);

      return {
        ...state,
        revision: state.revision + 1,
        phase: 'answering',
        roundNumber: 1,
        letter,
        answers: [],
        verdicts: [],
        currentRoundScores: [],
      };
    }

    case 'submit_answers': {
      requirePhase(state, 'answering');
      requirePlayer(state, action.playerId);

      const submittedAnswers = state.categories.map((category) => ({
        playerId: action.playerId,
        category,
        text: action.answers[category]?.trim() ?? '',
      }));

      const withoutPlayer = state.answers.filter((answer) => answer.playerId !== action.playerId);

      return {
        ...state,
        revision: state.revision + 1,
        answers: [...withoutPlayer, ...submittedAnswers],
      };
    }

    case 'open_reveal':
      requirePhase(state, 'answering');
      return { ...state, revision: state.revision + 1, phase: 'reveal' };

    case 'open_scoring':
      requirePhase(state, 'reveal');
      return { ...state, revision: state.revision + 1, phase: 'scoring' };

    case 'set_verdict': {
      requirePhase(state, 'scoring');
      requirePlayer(state, action.playerId);
      requireCategory(state, action.category);

      const nextVerdict = {
        playerId: action.playerId,
        category: action.category,
        verdict: action.verdict,
      };
      const withoutExisting = state.verdicts.filter(
        (verdict) => answerKey(verdict.playerId, verdict.category) !== answerKey(action.playerId, action.category),
      );

      return { ...state, revision: state.revision + 1, verdicts: [...withoutExisting, nextVerdict] };
    }

    case 'complete_scoring': {
      requirePhase(state, 'scoring');
      const scores = calculateRoundScores(state);
      const scoreByPlayer = new Map(scores.map((score) => [score.playerId, score]));

      return {
        ...state,
        revision: state.revision + 1,
        phase: 'leaderboard',
        currentRoundScores: scores,
        players: state.players.map((player) => ({
          ...player,
          score: player.score + (scoreByPlayer.get(player.id)?.totalPoints ?? 0),
          invalidStreak: scoreByPlayer.get(player.id)?.invalidStreak ?? player.invalidStreak,
        })),
        history: [
          ...state.history,
          {
            number: state.roundNumber,
            letter: state.letter ?? '',
            answers: [...state.answers],
            verdicts: [...state.verdicts],
            scores,
          },
        ],
      };
    }

    case 'start_next_round': {
      requirePhase(state, 'leaderboard');

      if (state.roundNumber >= state.totalRounds) {
        throw new Error('The match has already reached its final round.');
      }

      return {
        ...state,
        revision: state.revision + 1,
        phase: 'answering',
        roundNumber: state.roundNumber + 1,
        letter: cleanLetter(action.letter),
        answers: [],
        verdicts: [],
        currentRoundScores: [],
      };
    }

    case 'finish_match':
      requirePhase(state, 'leaderboard');
      return { ...state, revision: state.revision + 1, phase: 'finished' };
  }
}

export function normalizeAnswer(answer: string): string {
  return answer.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export function findDuplicateAnswerKeys(answers: readonly MatchAnswer[]) {
  const seen = new Map<string, string>();
  const duplicates = new Set<string>();

  for (const answer of answers) {
    const normalized = normalizeAnswer(answer.text);
    if (!normalized) continue;

    const key = `${answer.category}:${normalized}`;
    const previousPlayerId = seen.get(key);

    if (previousPlayerId) {
      duplicates.add(answerKey(previousPlayerId, answer.category));
      duplicates.add(answerKey(answer.playerId, answer.category));
    } else {
      seen.set(key, answer.playerId);
    }
  }

  return duplicates;
}
