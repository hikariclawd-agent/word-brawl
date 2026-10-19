import { describe, expect, it } from 'vitest';

import {
  createMatch,
  findDuplicateAnswerKeys,
  reduceMatch,
  type MatchState,
} from './index';

function makeMatch(): MatchState {
  return createMatch({
    categories: ['Name', 'Animal'],
    roundSeconds: 90,
    totalRounds: 2,
    players: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
  });
}

describe('Word Brawl match state machine', () => {
  it('moves through a complete round and applies scores', () => {
    let state = reduceMatch(makeMatch(), { type: 'start_match', letter: 'A' });

    state = reduceMatch(state, {
      type: 'submit_answers',
      playerId: 'a',
      answers: { Name: 'Amina', Animal: 'Antelope' },
    });
    state = reduceMatch(state, {
      type: 'submit_answers',
      playerId: 'b',
      answers: { Name: 'Alex', Animal: '' },
    });
    state = reduceMatch(state, { type: 'open_reveal' });
    state = reduceMatch(state, { type: 'open_scoring' });
    state = reduceMatch(state, { type: 'set_verdict', playerId: 'a', category: 'Name', verdict: 'valid' });
    state = reduceMatch(state, { type: 'set_verdict', playerId: 'a', category: 'Animal', verdict: 'valid' });
    state = reduceMatch(state, { type: 'set_verdict', playerId: 'b', category: 'Name', verdict: 'variant' });
    state = reduceMatch(state, { type: 'complete_scoring' });

    expect(state.phase).toBe('leaderboard');
    expect(state.players.find((player) => player.id === 'a')?.score).toBe(20);
    expect(state.players.find((player) => player.id === 'b')?.score).toBe(5);
    expect(state.history).toHaveLength(1);
    expect(state.revision).toBeGreaterThan(0);
  });

  it('uses versioned, configurable rules instead of hardcoded scoring', () => {
    let state = createMatch({
      categories: ['Name'],
      roundSeconds: 30,
      totalRounds: 1,
      rules: {
        modeId: 'blitz',
        rulesetVersion: 2,
        scores: { valid: 20, duplicate: 2, variant: 10, invalid: 0, blank: 0, disputed: 0 },
      },
      players: [{ id: 'a', name: 'A' }],
    });

    state = reduceMatch(state, { type: 'start_match', letter: 'B' });
    state = reduceMatch(state, { type: 'submit_answers', playerId: 'a', answers: { Name: 'Bola' } });
    state = reduceMatch(state, { type: 'open_reveal' });
    state = reduceMatch(state, { type: 'open_scoring' });
    state = reduceMatch(state, { type: 'set_verdict', playerId: 'a', category: 'Name', verdict: 'valid' });
    state = reduceMatch(state, { type: 'complete_scoring' });

    expect(state.rules.modeId).toBe('blitz');
    expect(state.rules.rulesetVersion).toBe(2);
    expect(state.players[0].score).toBe(20);
  });

  it('enforces the configured player limit', () => {
    expect(() => createMatch({
      categories: ['Name'],
      roundSeconds: 30,
      totalRounds: 1,
      rules: { maxPlayers: 1 },
      players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
    })).toThrow('A match cannot have more than 1 players.');
  });

  it('rejects actions in the wrong phase', () => {
    expect(() => reduceMatch(makeMatch(), { type: 'open_reveal' })).toThrow(
      'Cannot perform this action during lobby.',
    );
  });

  it('requires the final round to be finished instead of starting another one', () => {
    let state = makeMatch();
    state = reduceMatch(state, { type: 'start_match', letter: 'A' });
    state = reduceMatch(state, { type: 'open_reveal' });
    state = reduceMatch(state, { type: 'open_scoring' });
    state = reduceMatch(state, { type: 'complete_scoring' });
    state = reduceMatch(state, { type: 'start_next_round', letter: 'B' });
    state = reduceMatch(state, { type: 'open_reveal' });
    state = reduceMatch(state, { type: 'open_scoring' });
    state = reduceMatch(state, { type: 'complete_scoring' });

    expect(() => reduceMatch(state, { type: 'start_next_round', letter: 'C' })).toThrow(
      'The match has already reached its final round.',
    );
  });
});

describe('findDuplicateAnswerKeys', () => {
  it('finds duplicates within the same category but not across categories', () => {
    const duplicates = findDuplicateAnswerKeys([
      { playerId: 'a', category: 'Name', text: ' Alex ' },
      { playerId: 'b', category: 'Name', text: 'alex' },
      { playerId: 'c', category: 'Animal', text: 'Alex' },
    ]);

    expect(duplicates).toEqual(new Set(['a:Name', 'b:Name']));
  });
});
