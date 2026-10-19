import { describe, expect, it } from 'vitest';

import { countAnsweredBotAnswers } from './statisticsPresentation';

const fixture = [
  { botId: 'bot-1', category: 'Name', answer: 'Alice' },
  { botId: 'bot-1', category: 'Place', answer: '  ' },
  { botId: 'bot-1', category: 'Animal', answer: 'Ant' },
  { botId: 'bot-2', category: 'Name', answer: 'Bola' },
];

describe('CPU statistics presentation', () => {
  it('counts only non-empty trimmed CPU answers for an online snapshot', () => {
    expect(countAnsweredBotAnswers(fixture, 'bot-1')).toBe(2);
  });

  it('counts only non-empty trimmed CPU answers for local bot summaries', () => {
    expect(countAnsweredBotAnswers(fixture, 'bot-2')).toBe(1);
  });
});
