export {
  calculateInvalidStreakPenalty,
  getAnswerOutcome,
  OUTCOME_SCORE_VALUES,
  SCORE_VALUES,
  scoreAnswer,
  scoreOutcome,
  type AnswerOutcome,
  type AnswerVerdict,
  type InvalidStreakPenaltyInput,
  type ScoreAnswerInput,
} from './scoring';

export function pickRoundLetter(letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"): string {
  const cleanLetters = letters.replace(/[^A-Z]/gi, "").toUpperCase();

  if (!cleanLetters.length) {
    throw new Error("At least one letter is required.");
  }

  return cleanLetters[Math.floor(Math.random() * cleanLetters.length)];
}

export function createRoomCode(length = 6): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let index = 0; index < length; index += 1) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }

  return code;
}

export {
  calculateRoundScores,
  createMatch,
  DEFAULT_MATCH_RULES,
  findDuplicateAnswerKeys,
  normalizeAnswer,
  reduceMatch,
  type CreateMatchInput,
  type MatchAction,
  type MatchAnswer,
  type MatchPhase,
  type MatchPlayer,
  type MatchRules,
  type MatchRound,
  type MatchState,
  type MatchVerdict,
  type RoundScoreBreakdown,
} from './match';
