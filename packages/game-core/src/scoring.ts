export type AnswerVerdict = "valid" | "duplicate" | "variant" | "invalid" | "blank" | "disputed";

/** The small set of outcomes players need to understand. */
export type AnswerOutcome = "unique" | "shared" | "no_score";

export const SCORE_VALUES: Record<AnswerVerdict, number> = {
  valid: 10,
  duplicate: 5,
  variant: 5,
  invalid: 0,
  blank: 0,
  disputed: 0,
};

export type ScoreAnswerInput = {
  verdict: AnswerVerdict;
};

export function scoreAnswer(input: ScoreAnswerInput): number {
  return SCORE_VALUES[input.verdict];
}

export const OUTCOME_SCORE_VALUES: Record<AnswerOutcome, number> = {
  unique: 10,
  shared: 5,
  no_score: 0,
};

export function getAnswerOutcome(verdict: AnswerVerdict): AnswerOutcome {
  if (verdict === "valid") {
    return "unique";
  }

  if (verdict === "duplicate" || verdict === "variant") {
    return "shared";
  }

  return "no_score";
}

export function scoreOutcome(outcome: AnswerOutcome): number {
  return OUTCOME_SCORE_VALUES[outcome];
}

export type InvalidStreakPenaltyInput = {
  invalidStreak: number;
  threshold?: number;
  penaltyPoints?: number;
};

export function calculateInvalidStreakPenalty({
  invalidStreak,
  threshold = 3,
  penaltyPoints = 5,
}: InvalidStreakPenaltyInput): number {
  if (invalidStreak < threshold) {
    return 0;
  }

  return -penaltyPoints;
}
