import { describe, expect, it, vi } from 'vitest';
import {
  buildReviewCategoryDeck,
  buildScoreComparisonEntries,
  classifyReview,
  resolveReviewSelection,
  reviewDetailsVisible,
  reviewResolution,
} from './reviewPresentation';
import type { OnlineRevealAnswer } from './onlineRooms';
describe('review identity', () => {
  const selected = { context: 'room:round-1', answerId: 'self:Name' };
  it('reads current word and points, never the selected snapshot', () => {
    const live = { id: 'self:Name', answer: 'Alice', points: 0 };
    expect(resolveReviewSelection(selected, selected.context, [live])).toBe(live);
    const updated = { ...live, points: 5 };
    expect(resolveReviewSelection(selected, selected.context, [updated])).toBe(updated);
  });
  it.each(['room:round-2', 'other:round-1', 'new-match:round-1'])('rejects reused IDs in %s', context => {
    expect(resolveReviewSelection(selected, context, [{ id: selected.answerId }])).toBeNull();
  });
  it('rejects removed answers and cleared selections', () => {
    expect(resolveReviewSelection(selected, selected.context, [])).toBeNull();
    expect(resolveReviewSelection(null, selected.context, [{ id: selected.answerId }])).toBeNull();
  });
  it('changes selection independently of category', () => {
    const answers = [{ id: 'a' }, { id: 'b' }];
    expect(resolveReviewSelection({ context: 'r', answerId: 'b' }, 'r', answers)).toBe(answers[1]);
  });
});
describe('review resolution', () => {
  it.each(['variant', 'duplicate'] as const)('settled %s is Shared', status => {
    expect(classifyReview({ status, isNoAnswer: false, resolution: 'resolved' })).toBe('shared');
    expect(classifyReview({ status, isNoAnswer: false, resolution: 'none' })).toBe('shared');
    expect(classifyReview({ status, isNoAnswer: false, resolution: 'open' })).toBe('pending');
  });
  it('server open state wins over any local outcome or submitted vote', () => {
    expect(reviewResolution('open', true, 'variant')).toBe('open');
    expect(reviewResolution('resolved', true)).toBe('resolved');
  });
  it('local disputes require final outcomes, not player votes', () => {
    expect(reviewResolution(undefined, true)).toBe('open');
    expect(reviewResolution(undefined, true, 'variant')).toBe('resolved');
    expect(reviewResolution(undefined, false)).toBe('none');
  });
  it('retains genuine disputed, invalid and blank states', () => {
    expect(classifyReview({ status: 'disputed', isNoAnswer: false, resolution: 'none' })).toBe('pending');
    expect(classifyReview({ status: 'invalid', isNoAnswer: false, resolution: 'none' })).toBe('invalid');
    expect(classifyReview({ status: 'blank', isNoAnswer: true, resolution: 'none' })).toBe('blank');
  });
});
it('never presents mobile details over a result, including before selection cleanup', () => {
  expect(reviewDetailsVisible(false, true, false)).toBe(true);
  expect(reviewDetailsVisible(false, true, true)).toBe(false);
  expect(reviewDetailsVisible(false, false, false)).toBe(false);
  expect(reviewDetailsVisible(true, true, false)).toBe(false);
});

describe('pure review projections', () => {
  const onlineAnswer = (answer: string, overrides: Partial<OnlineRevealAnswer> = {}): OnlineRevealAnswer => ({
    answer,
    category: 'Name',
    id: `answer-${answer}`,
    playerId: 'other',
    playerName: 'Other',
    points: 5,
    verdict: 'variant',
    votes: [],
    ...overrides,
  });

  const deck = (answer: string, otherAnswer: string, category: 'Name' | 'Place' = 'Name') => buildReviewCategoryDeck({
    answers: { [category]: answer },
    botRoundAnswers: [],
    disputedBotAnswers: [],
    disputedCategories: [],
    isOnline: true,
    laneColor: () => 'red',
    onlineRevealAnswers: [onlineAnswer(otherAnswer, { category })],
    playerId: 'me',
    selectedCategories: [category],
    verdicts: { [category]: 'valid' },
  });

  it.each([
    ['Élodie', 'Elodie'],
    ['New York', 'NewYork'],
    ['N’Djamena', 'NDjamena'],
  ])('uses canonical comparison keys for %s and %s', (selfAnswer, otherAnswer) => {
    const result = deck(selfAnswer, otherAnswer)[0];
    expect(result.duplicateCount).toBe(1);
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ answer: selfAnswer, isDuplicate: true }),
      expect.objectContaining({ answer: otherAnswer, isDuplicate: true }),
    ]));
  });

  it('keeps duplicates category-scoped and excludes blank answers', () => {
    const result = buildReviewCategoryDeck({
      answers: { Name: 'Alice', Place: '' },
      botRoundAnswers: [{ answer: 'Alice', botId: 'bot-1', botName: 'CPU', category: 'Place', points: 0, verdict: 'blank' }],
      disputedBotAnswers: [],
      disputedCategories: [],
      isOnline: false,
      laneColor: () => 'red',
      onlineRevealAnswers: [],
      playerId: 'me',
      selectedCategories: ['Name', 'Place'],
      verdicts: { Name: 'valid', Place: 'blank' },
    });

    expect(result.find((card) => card.category === 'Name')?.duplicateCount).toBe(0);
    expect(result.find((card) => card.category === 'Place')?.duplicateCount).toBe(0);
    expect(result.find((card) => card.category === 'Place')?.entries[0]).toMatchObject({ answer: 'No answer', isNoAnswer: true });
  });

  it('preserves display text and authoritative online verdicts and points', () => {
    const result = buildReviewCategoryDeck({
      answers: { Name: '  Élodie  ' },
      botRoundAnswers: [],
      disputedBotAnswers: [],
      disputedCategories: [],
      isOnline: true,
      laneColor: () => 'red',
      onlineRevealAnswers: [onlineAnswer('  Elodie  ', { playerId: 'me', points: 0, verdict: 'blank' })],
      playerId: 'me',
      scoreAnswer: vi.fn(() => 10),
      selectedCategories: ['Name'],
      verdicts: { Name: 'valid' },
    });

    expect(result[0].entries[0]).toMatchObject({ answer: 'Elodie', points: 0, verdict: 'blank' });
  });

  it('preserves offline verdict-to-points projection and distinct identities', () => {
    const score = vi.fn(({ verdict }: { verdict: string }) => verdict === 'valid' ? 10 : 5);
    const result = buildReviewCategoryDeck({
      answers: { Name: 'Alice' },
      assignedBotScoringTargetId: 'bot-1',
      botRoundAnswers: [{ answer: 'Alice', botId: 'bot-1', botName: 'CPU', category: 'Name', points: 5, verdict: 'variant' }],
      disputedBotAnswers: [],
      disputedCategories: [],
      isOnline: false,
      laneColor: () => 'red',
      onlineRevealAnswers: [],
      playerId: 'me',
      scoreAnswer: score as typeof import('@animal-name-place/game-core').scoreAnswer,
      selectedCategories: ['Name'],
      verdicts: { Name: 'valid' },
    });

    expect(result[0].entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'review-self-Name', label: 'You', points: 10 }),
      expect.objectContaining({ id: 'review-bot-1-Name', label: 'CPU', points: 5 }),
    ]));
    expect(new Set(result[0].entries.map((entry) => entry.id)).size).toBe(2);
  });

  it('matches comparison entries by canonical key without changing display text', () => {
    const result = buildScoreComparisonEntries({
      answers: { Place: 'New York' },
      botRoundAnswers: [{ answer: 'NewYork', botId: 'bot-1', botName: 'CPU', category: 'Place', points: 5, verdict: 'variant' }],
      isOnline: false,
      onlineRevealAnswers: [],
      playerId: 'me',
      scoreCard: { answer: 'New York', category: 'Place', key: 'bot-2:Place', targetId: 'bot-2' },
      verdicts: { Place: 'valid' },
    });

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ answer: 'New York', isMatch: true }),
      expect.objectContaining({ answer: 'NewYork', isMatch: true }),
    ]));
  });
});
