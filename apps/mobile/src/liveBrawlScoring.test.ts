import { describe, expect, it, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import {
  assertFiveActorFourCategoryContract,
  projectCyclicAssignments,
  type LiveBrawlActor,
  type LiveBrawlAnswerTarget,
  type LiveBrawlScoreAssignment,
} from './liveBrawlScoring';

const actors: LiveBrawlActor[] = [
  { id: 'human', actorKey: 'human:1', actorKind: 'human', displayName: 'Human', roomPlayerId: '1', seatIndex: 0 },
  ...Array.from({ length: 4 }, (_, index) => ({
    id: `bot-${index + 1}`, actorKey: `bot-${index + 1}`, actorKind: 'bot' as const,
    displayName: `Bot ${index + 1}`, botIndex: index + 1, roomPlayerId: null, seatIndex: index + 1,
  })),
];

const targets: LiveBrawlAnswerTarget[] = actors.flatMap((actor) => ['Name', 'Place', 'Animal', 'Food'].map((category, index) => ({
  actorId: actor.id, answerText: `${actor.id}-${category}`, category,
  canonicalVerdict: 'valid', id: `${actor.id}-${index}`, points: 10, status: 'pending', verdict: 'valid',
})));

describe('Live Brawl five-actor scoring contract', () => {
  it('assigns all 20 targets to the next seat with no self-scoring', () => {
    const projected = projectCyclicAssignments(actors, targets);
    expect(projected).toHaveLength(20);
    expect(projected.every((assignment) => {
      const target = targets.find((candidate) => candidate.id === assignment.answerTargetId);
      return target?.actorId !== assignment.scorerActorId;
    })).toBe(true);
    expect(projected.filter((assignment) => assignment.scorerActorId === 'human')).toHaveLength(4);
    expect(projected.filter((assignment) => assignment.scorerActorId === 'bot-1')).toHaveLength(4);
  });

  it('accepts the one-human/four-bot four-category vector', () => {
    const assignments: LiveBrawlScoreAssignment[] = projectCyclicAssignments(actors, targets).map((assignment, index) => ({
      ...assignment, id: `assignment-${index}`, scoringEndsAt: '2026-10-21T14:00:00Z', status: 'pending',
    }));
    expect(assertFiveActorFourCategoryContract(actors, targets, assignments, ['Name', 'Place', 'Animal', 'Food'])).toBe(true);
  });

  it('rejects a missing target or self-scoring assignment', () => {
    const invalid = [{ id: 'bad', answerTargetId: 'human-0', scorerActorId: 'human', scoringEndsAt: '', status: 'pending' as const }];
    expect(() => assertFiveActorFourCategoryContract(actors, targets, invalid, ['Name', 'Place', 'Animal', 'Food'])).toThrow('20 score assignments');
  });
});
