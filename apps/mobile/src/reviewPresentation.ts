import { normalizeAnswer, scoreAnswer, type AnswerVerdict } from '@animal-name-place/game-core';
import type { StarterCategory } from '@animal-name-place/shared';
import type { OnlineRevealAnswer } from './onlineRooms';

export type ReviewSelection = { context: string; answerId: string };
export type ReviewResolution = 'none' | 'open' | 'resolved';
export type ReviewPresentationInput = {
  status: 'valid' | 'variant' | 'invalid' | 'blank' | 'duplicate' | 'disputed';
  isNoAnswer: boolean;
  resolution: ReviewResolution;
};

type ReviewBotAnswer = {
  answer: string;
  botId: string;
  botName: string;
  category: StarterCategory;
  points: number;
  verdict: AnswerVerdict;
};

type ReviewDeckEntry = {
  answer: string;
  id: string;
  isDisputed: boolean;
  isDuplicate?: boolean;
  isNoAnswer: boolean;
  label: string;
  points: number;
  verdict: AnswerVerdict;
};

export type ReviewCategoryDeck = {
  category: StarterCategory;
  color: string;
  duplicateCount: number;
  entries: ReviewDeckEntry[];
};

type ReviewDeckInput = {
  answers: Partial<Record<StarterCategory, string>>;
  assignedBotScoringTargetId?: string;
  assignedHumanScoringTargetId?: string;
  botRoundAnswers: readonly ReviewBotAnswer[];
  disputedBotAnswers: readonly string[];
  disputedCategories: readonly StarterCategory[];
  isOnline: boolean;
  laneColor: (index: number) => string;
  onlineRevealAnswers: readonly OnlineRevealAnswer[];
  playerId?: string;
  scoreAnswer?: typeof scoreAnswer;
  selectedCategories: readonly StarterCategory[];
  verdicts: Partial<Record<StarterCategory, AnswerVerdict>>;
};

export function buildReviewCategoryDeck({
  answers,
  assignedBotScoringTargetId,
  assignedHumanScoringTargetId,
  botRoundAnswers,
  disputedBotAnswers,
  disputedCategories,
  isOnline,
  laneColor,
  onlineRevealAnswers,
  playerId,
  scoreAnswer: score = scoreAnswer,
  selectedCategories,
  verdicts,
}: ReviewDeckInput): ReviewCategoryDeck[] {
  return selectedCategories.map((category, categoryIndex) => {
    const ownOnlineAnswer = onlineRevealAnswers.find((onlineAnswer) => (
      onlineAnswer.category === category && onlineAnswer.playerId === playerId
    ));
    const selfAnswer = isOnline
      ? ownOnlineAnswer?.answer.trim() ?? answers[category]?.trim() ?? ''
      : answers[category]?.trim() ?? '';
    const selfVerdict = isOnline && ownOnlineAnswer ? ownOnlineAnswer.verdict : verdicts[category] ?? 'blank';
    const entries: ReviewDeckEntry[] = [
      {
        answer: selfAnswer || 'No answer',
        id: `review-self-${category}`,
        isDisputed: disputedCategories.includes(category) || Boolean(ownOnlineAnswer?.dispute),
        isNoAnswer: !selfAnswer,
        label: 'You',
        points: isOnline && ownOnlineAnswer ? ownOnlineAnswer.points : score({ verdict: selfVerdict }),
        verdict: selfVerdict,
      },
      ...onlineRevealAnswers
        .filter((onlineAnswer) => (
          onlineAnswer.category === category && onlineAnswer.playerId !== playerId
        ))
        .sort((a, b) => (
          Number(b.playerId === assignedHumanScoringTargetId) - Number(a.playerId === assignedHumanScoringTargetId)
        ))
        .map((onlineAnswer) => ({
          answer: onlineAnswer.answer.trim() || 'No answer',
          id: onlineAnswer.id,
          isDisputed: onlineAnswer.dispute?.status === 'open' || onlineAnswer.dispute?.status === 'resolved',
          isNoAnswer: !onlineAnswer.answer.trim(),
          label: onlineAnswer.playerName,
          points: onlineAnswer.points,
          verdict: onlineAnswer.verdict,
        })),
      ...botRoundAnswers
        .filter((botAnswer) => botAnswer.category === category)
        .sort((a, b) => (
          Number(b.botId === assignedBotScoringTargetId) - Number(a.botId === assignedBotScoringTargetId)
        ))
        .map((botAnswer) => ({
          answer: botAnswer.answer.trim() || 'No answer',
          id: `review-${botAnswer.botId}-${category}`,
          isDisputed: disputedBotAnswers.includes(`${botAnswer.botId}:${category}`),
          isNoAnswer: !botAnswer.answer.trim(),
          label: botAnswer.botName,
          points: botAnswer.points,
          verdict: botAnswer.verdict,
        })),
    ];
    const answerCounts = entries.reduce<Record<string, number>>((counts, entry) => {
      if (entry.isNoAnswer) return counts;
      const key = normalizeAnswer(entry.answer);
      counts[key] = (counts[key] ?? 0) + 1;
      return counts;
    }, {});

    return {
      category,
      color: laneColor(categoryIndex),
      duplicateCount: Object.values(answerCounts).filter((count) => count > 1).length,
      entries: entries.map((entry) => ({
        ...entry,
        isDuplicate: !entry.isNoAnswer && answerCounts[normalizeAnswer(entry.answer)] > 1,
      })),
    };
  }).filter((deckCard) => deckCard.entries.length);
}

export type ScoreComparisonCard = {
  answer: string;
  category: StarterCategory;
  key: string;
  targetId: string;
};

export type ScoreComparisonEntry = {
  answer: string;
  id: string;
  isMatch: boolean;
  isNoAnswer: boolean;
  label: string;
  points: number;
  verdict: AnswerVerdict;
};

type ScoreComparisonInput = Pick<ReviewDeckInput,
  'answers' | 'botRoundAnswers' | 'isOnline' | 'onlineRevealAnswers' | 'playerId' | 'scoreAnswer' | 'verdicts'
> & { scoreCard: ScoreComparisonCard | null };

export function buildScoreComparisonEntries({
  answers,
  botRoundAnswers,
  isOnline,
  onlineRevealAnswers,
  playerId,
  scoreAnswer: score = scoreAnswer,
  scoreCard,
  verdicts,
}: ScoreComparisonInput): ScoreComparisonEntry[] {
  if (!scoreCard) return [];

  const activeAnswerKey = normalizeAnswer(scoreCard.answer);
  const ownOnlineAnswer = onlineRevealAnswers.find((onlineAnswer) => (
    onlineAnswer.category === scoreCard.category && onlineAnswer.playerId === playerId
  ));
  const selfAnswer = isOnline
    ? ownOnlineAnswer?.answer.trim() ?? answers[scoreCard.category]?.trim() ?? ''
    : answers[scoreCard.category]?.trim() ?? '';
  const selfVerdict = isOnline && ownOnlineAnswer ? ownOnlineAnswer.verdict : verdicts[scoreCard.category] ?? 'blank';
  const entries: Omit<ScoreComparisonEntry, 'isMatch'>[] = [
    ...(scoreCard.targetId !== 'self' ? [{
      answer: selfAnswer || 'No answer',
      id: `compare-self-${scoreCard.category}`,
      isNoAnswer: !selfAnswer,
      label: 'You',
      points: isOnline && ownOnlineAnswer ? ownOnlineAnswer.points : score({ verdict: selfVerdict }),
      verdict: selfVerdict,
    }] : []),
    ...onlineRevealAnswers
      .filter((onlineAnswer) => (
        onlineAnswer.category === scoreCard.category
        && onlineAnswer.playerId !== playerId
        && onlineAnswer.id !== scoreCard.key
      ))
      .map((onlineAnswer) => ({
        answer: onlineAnswer.answer.trim() || 'No answer',
        id: `compare-${onlineAnswer.id}`,
        isNoAnswer: !onlineAnswer.answer.trim(),
        label: onlineAnswer.playerName,
        points: onlineAnswer.points,
        verdict: onlineAnswer.verdict,
      })),
    ...botRoundAnswers
      .filter((botAnswer) => (
        botAnswer.category === scoreCard.category
        && `${botAnswer.botId}:${botAnswer.category}` !== scoreCard.key
      ))
      .map((botAnswer) => ({
        answer: botAnswer.answer.trim() || 'No answer',
        id: `compare-${botAnswer.botId}-${botAnswer.category}`,
        isNoAnswer: !botAnswer.answer.trim(),
        label: botAnswer.botName,
        points: botAnswer.points,
        verdict: botAnswer.verdict,
      })),
  ];

  return entries.map((entry) => ({
    ...entry,
    isMatch: Boolean(activeAnswerKey && !entry.isNoAnswer && normalizeAnswer(entry.answer) === activeAnswerKey),
  }));
}

export function resolveReviewSelection<T extends { id: string }>(selection: ReviewSelection | null, context: string, answers: T[]): T | null {
  if (!selection || selection.context !== context) return null;
  return answers.find((answer) => answer.id === selection.answerId) ?? null;
}

// Only a completed local outcome or explicit server resolution settles a dispute.
// A submitted vote is deliberately not an input.
export function reviewResolution(serverStatus: 'open' | 'resolved' | undefined, localDisputed: boolean, localFinalVerdict?: string): ReviewResolution {
  if (serverStatus) return serverStatus;
  return localDisputed ? localFinalVerdict ? 'resolved' : 'open' : 'none';
}

export function classifyReview(answer: ReviewPresentationInput): 'blank' | 'pending' | 'invalid' | 'shared' | 'valid' {
  if (answer.resolution === 'open' || answer.status === 'disputed') return 'pending';
  if (answer.isNoAnswer || answer.status === 'blank') return 'blank';
  if (answer.status === 'invalid') return 'invalid';
  if (answer.status === 'variant' || answer.status === 'duplicate') return 'shared';
  return 'valid';
}

export function reviewDetailsVisible(wide: boolean, selected: boolean, resultNotice: boolean): boolean {
  return !wide && selected && !resultNotice;
}
