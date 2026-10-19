import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBotRoundAnswers,
  findMatchingBotAnswer,
  getKnownCategoriesForAnswer,
  markDuplicateBotAnswers,
  scoreBotOwnAnswers,
  scoreBotRoundAnswers,
  type BotRoundAnswer,
} from './localBotRound';

const answers = (overrides: Partial<Record<'Name' | 'Place' | 'Animal' | 'Brand' | 'Food' | 'Job' | 'Object', string>> = {}) => ({
  Name: '', Place: '', Animal: '', Brand: '', Food: '', Job: '', Object: '', ...overrides,
});

const botAnswer = (overrides: Partial<BotRoundAnswer> = {}): BotRoundAnswer => ({
  answer: 'Alice', botId: 'bot-1', botName: 'Nova', category: 'Name', points: 10, verdict: 'valid', ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe('local CPU round logic', () => {
  describe('findMatchingBotAnswer', () => {
    it.each([
      ['Élodie', 'Elodie'],
      ['New York', 'NewYork'],
      ['N’Djamena', 'NDjamena'],
    ])('matches canonical-equivalent answers: %s and %s', (humanAnswer, cpuAnswer) => {
      const cpu = botAnswer({ answer: cpuAnswer });
      expect(findMatchingBotAnswer(humanAnswer, 'Name', [cpu])).toBe(cpu);
    });

    it('rejects category mismatches, blank CPU answers and blank human input', () => {
      const wrongCategory = botAnswer({ answer: 'Elodie', category: 'Place' });
      const blankCpu = botAnswer({ answer: '', points: 0, verdict: 'blank' });

      expect(findMatchingBotAnswer('Elodie', 'Name', [wrongCategory])).toBeUndefined();
      expect(findMatchingBotAnswer('Elodie', 'Name', [blankCpu])).toBeUndefined();
      expect(findMatchingBotAnswer('   ', 'Name', [botAnswer({ answer: 'Elodie' })])).toBeUndefined();
    });

    it('returns undefined when no canonical match exists and preserves the CPU object', () => {
      const cpu = botAnswer({ answer: 'Elodie' });

      expect(findMatchingBotAnswer('Nadia', 'Name', [cpu])).toBeUndefined();
      expect(findMatchingBotAnswer('Elodie', 'Name', [cpu])).toBe(cpu);
      expect(cpu.answer).toBe('Elodie');
    });
  });

  it('keeps duplicate detection category-scoped, excludes blanks and preserves display text', () => {
    const result = markDuplicateBotAnswers([
      botAnswer({ answer: ' Élodie ', botId: 'bot-1' }),
      botAnswer({ answer: 'Elodie', botId: 'bot-2' }),
      botAnswer({ answer: 'New York', botId: 'bot-3', category: 'Place' }),
      botAnswer({ answer: '', botId: 'bot-4', category: 'Name', points: 0, verdict: 'blank' }),
    ], answers({ Name: 'Elodie', Place: 'NewYork' }), ['Name', 'Place']);

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ botId: 'bot-1', answer: ' Élodie ', verdict: 'duplicate', points: 5 }),
      expect.objectContaining({ botId: 'bot-2', answer: 'Elodie', verdict: 'duplicate', points: 5 }),
      expect.objectContaining({ botId: 'bot-3', answer: 'New York', verdict: 'duplicate', points: 5 }),
      expect.objectContaining({ botId: 'bot-4', answer: '', verdict: 'blank', points: 0 }),
    ]));
  });

  it.each([
    ['Élodie', 'Elodie'],
    ['New York', 'NewYork'],
    ['N’Djamena', 'NDjamena'],
  ])('uses the canonical comparison key for %s and %s', (first, second) => {
    const result = markDuplicateBotAnswers([
      botAnswer({ answer: first, botId: 'bot-1' }),
      botAnswer({ answer: second, botId: 'bot-2' }),
    ], answers(), ['Name']);

    expect(result.map((entry) => entry.verdict)).toEqual(['duplicate', 'duplicate']);
  });

  it('does not create a known category for a blank answer', () => {
    expect(getKnownCategoriesForAnswer('   ')).toEqual([]);
  });

  it('preserves existing verdicts and applies the established local verdict points', () => {
    const result = scoreBotOwnAnswers([
      botAnswer({ answer: 'Alex', verdict: 'blank', points: 0 }),
      botAnswer({ answer: 'Alicia', botId: 'bot-2', verdict: 'blank', points: 0 }),
      botAnswer({ answer: 'Bob', botId: 'bot-3', verdict: 'blank', points: 0 }),
      botAnswer({ answer: '', botId: 'bot-4', verdict: 'blank', points: 0 }),
      botAnswer({ answer: 'Alex', botId: 'bot-5', verdict: 'duplicate', points: 5 }),
    ], 'A', 'Strict');

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ botId: 'bot-1', verdict: 'valid', points: 10 }),
      expect.objectContaining({ botId: 'bot-2', verdict: 'variant', points: 5 }),
      expect.objectContaining({ botId: 'bot-3', verdict: 'invalid', points: 0 }),
      expect.objectContaining({ botId: 'bot-4', verdict: 'blank', points: 0 }),
      expect.objectContaining({ botId: 'bot-5', verdict: 'duplicate', points: 5 }),
    ]));
  });

  it('generates one identity-preserving row per selected bot and category', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const result = createBotRoundAnswers(2, ['Nova', 'Pixel'], ['Agreeable', 'Careful'], ['Name', 'Place'], 'Normal', 'A');

    expect(result).toHaveLength(4);
    expect(result.map(({ botId, botName, category }) => ({ botId, botName, category }))).toEqual([
      { botId: 'bot-1', botName: 'Nova', category: 'Name' },
      { botId: 'bot-1', botName: 'Nova', category: 'Place' },
      { botId: 'bot-2', botName: 'Pixel', category: 'Name' },
      { botId: 'bot-2', botName: 'Pixel', category: 'Place' },
    ]);
    expect(result.every((entry) => entry.answer === '' || entry.answer.toUpperCase().startsWith('A'))).toBe(true);
  });

  it('keeps Easy blanks empty and preserves Hard typo metadata', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const easy = createBotRoundAnswers(1, ['Nova'], ['Agreeable'], ['Name'], 'Easy', 'A')[0];
    expect(easy).toMatchObject({ botId: 'bot-1', botName: 'Nova', category: 'Name', answer: '', points: 0, verdict: 'blank' });

    const random = vi.spyOn(Math, 'random');
    random.mockReturnValueOnce(0).mockReturnValueOnce(0.5).mockReturnValueOnce(0).mockReturnValueOnce(0.1).mockReturnValueOnce(0);
    const hard = createBotRoundAnswers(1, ['Pixel'], ['Agreeable'], ['Name'], 'Hard', 'A')[0];
    expect(hard.botId).toBe('bot-1');
    expect(hard.botName).toBe('Pixel');
    expect(hard.category).toBe('Name');
    expect(hard.answer).not.toBe('');
    expect(hard.verdict).toBe('blank');
    expect(hard.points).toBe(0);
  });

  it('maps canonical-equivalent human and CPU answers to duplicate points in the total', () => {
    const generated = markDuplicateBotAnswers([
      botAnswer({ answer: 'New York', botId: 'bot-1', category: 'Place', points: 0, verdict: 'blank' }),
      botAnswer({ answer: 'NewYork', botId: 'bot-2', category: 'Place', points: 0, verdict: 'blank' }),
      botAnswer({ answer: 'NewYork', botId: 'bot-3', category: 'Name', points: 0, verdict: 'blank' }),
      botAnswer({ answer: '', botId: 'bot-4', category: 'Place', points: 0, verdict: 'blank' }),
      botAnswer({ answer: 'Bob', botId: 'bot-5', category: 'Place', points: 0, verdict: 'invalid' }),
    ], answers({ Place: 'NewYork' }), ['Place']);
    const scored = scoreBotOwnAnswers(generated, 'N', 'Classic');

    expect(scored).toEqual(expect.arrayContaining([
      expect.objectContaining({ botId: 'bot-1', answer: 'New York', category: 'Place', verdict: 'duplicate', points: 5 }),
      expect.objectContaining({ botId: 'bot-2', answer: 'NewYork', category: 'Place', verdict: 'duplicate', points: 5 }),
      expect.objectContaining({ botId: 'bot-3', category: 'Name', verdict: 'variant', points: 5 }),
      expect.objectContaining({ botId: 'bot-4', answer: '', verdict: 'blank', points: 0 }),
      expect.objectContaining({ botId: 'bot-5', verdict: 'invalid', points: 0 }),
    ]));
    expect(scoreBotRoundAnswers(5, scored)).toEqual([5, 5, 5, 0, 0]);
  });

  it('accumulates points by bot identity', () => {
    expect(scoreBotRoundAnswers(2, [
      botAnswer({ points: 10 }),
      botAnswer({ botId: 'bot-1', category: 'Place', points: 5 }),
      botAnswer({ botId: 'bot-2', points: 10 }),
    ])).toEqual([15, 10]);
  });
});
