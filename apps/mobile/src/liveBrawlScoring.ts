import type { AnswerVerdict } from '@animal-name-place/game-core';

import { supabase } from './supabase';

export type LiveBrawlActor = {
  actorKind: 'human' | 'bot';
  actorKey: string;
  botIndex?: number | null;
  displayName: string;
  id: string;
  roomPlayerId?: string | null;
  seatIndex: number;
};

export type LiveBrawlAnswerTarget = {
  actorId: string;
  answerText: string;
  category: string;
  canonicalVerdict: AnswerVerdict;
  id: string;
  points: number;
  status: 'pending' | 'scored' | 'disputed' | 'resolved';
  verdict: Exclude<AnswerVerdict, 'disputed'> | 'no_score';
};

export type LiveBrawlScoreAssignment = {
  answerTargetId: string;
  id: string;
  scorerActorId: string;
  scoringEndsAt: string;
  status: 'pending' | 'scored' | 'timed_out';
};

export type LiveBrawlScoreDecision = {
  assignmentId: string;
  commandId?: string | null;
  scorerActorId: string;
  source: 'human' | 'bot' | 'timeout';
  verdict: string;
};

export type LiveBrawlDispute = {
  answerTargetId: string;
  disputeEndsAt: string;
  finalVerdict?: string | null;
  id: string;
  openedByActorId: string;
  status: 'open' | 'resolved' | 'timed_out';
};

export type LiveBrawlScoringSnapshot = {
  actors: LiveBrawlActor[];
  assignments: LiveBrawlScoreAssignment[];
  decisions: LiveBrawlScoreDecision[];
  disputes: LiveBrawlDispute[];
  targets: LiveBrawlAnswerTarget[];
};

/** Pure client projection used for rendering and regression tests. The server remains authoritative. */
export function projectCyclicAssignments(
  actors: readonly Pick<LiveBrawlActor, 'id' | 'seatIndex'>[],
  targets: readonly Pick<LiveBrawlAnswerTarget, 'actorId' | 'id'>[],
) {
  const ordered = [...actors].sort((a, b) => a.seatIndex - b.seatIndex);
  if (ordered.length < 2) return [];

  return targets.map((target) => {
    const ownerIndex = ordered.findIndex((actor) => actor.id === target.actorId);
    if (ownerIndex < 0) throw new Error(`Unknown target actor: ${target.actorId}`);
    return {
      answerTargetId: target.id,
      scorerActorId: ordered[(ownerIndex + 1) % ordered.length].id,
    };
  });
}

export function assertFiveActorFourCategoryContract(
  actors: readonly LiveBrawlActor[],
  targets: readonly LiveBrawlAnswerTarget[],
  assignments: readonly LiveBrawlScoreAssignment[],
  categories: readonly string[],
) {
  if (actors.length !== 5) throw new Error(`Expected five actors, received ${actors.length}`);
  if (categories.length !== 4) throw new Error(`Expected four categories, received ${categories.length}`);
  if (targets.length !== 20) throw new Error(`Expected 20 answer targets, received ${targets.length}`);
  if (assignments.length !== 20) throw new Error(`Expected 20 score assignments, received ${assignments.length}`);
  const selfAssignments = assignments.filter((assignment) => {
    const target = targets.find((candidate) => candidate.id === assignment.answerTargetId);
    return target?.actorId === assignment.scorerActorId;
  });
  if (selfAssignments.length > 0) throw new Error('Self-scoring assignment detected');
  return true;
}

export async function getLiveBrawlScoringSnapshot(roomId: string, roundId: string): Promise<LiveBrawlScoringSnapshot> {
  const [actors, targets, assignments, decisions, disputes] = await Promise.all([
    supabase.from('live_brawl_actors').select('id, actor_key, actor_kind, room_player_id, bot_index, seat_index, display_name').eq('room_id', roomId).order('seat_index'),
    supabase.from('live_brawl_answer_targets').select('id, actor_id, category, answer_text, canonical_verdict, verdict, points, status').eq('room_id', roomId).eq('round_id', roundId),
    supabase.from('live_brawl_score_assignments').select('id, answer_target_id, scorer_actor_id, scoring_ends_at, status').eq('room_id', roomId).eq('round_id', roundId),
    supabase.from('live_brawl_score_decisions').select('assignment_id, scorer_actor_id, verdict, source, command_id').eq('room_id', roomId).eq('round_id', roundId),
    supabase.from('live_brawl_disputes').select('id, answer_target_id, opened_by_actor_id, status, final_verdict, dispute_ends_at').eq('room_id', roomId).eq('round_id', roundId),
  ]);
  for (const result of [actors, targets, assignments, decisions, disputes]) if (result.error) throw new Error(result.error.message);
  return {
    actors: (actors.data ?? []).map((row) => ({
      id: row.id, actorKey: row.actor_key, actorKind: row.actor_kind, roomPlayerId: row.room_player_id,
      botIndex: row.bot_index, seatIndex: row.seat_index, displayName: row.display_name,
    })) as LiveBrawlActor[],
    targets: (targets.data ?? []).map((row) => ({
      id: row.id, actorId: row.actor_id, category: row.category, answerText: row.answer_text,
      canonicalVerdict: row.canonical_verdict, verdict: row.verdict, points: row.points, status: row.status,
    })) as LiveBrawlAnswerTarget[],
    assignments: (assignments.data ?? []).map((row) => ({
      id: row.id, answerTargetId: row.answer_target_id, scorerActorId: row.scorer_actor_id,
      scoringEndsAt: row.scoring_ends_at, status: row.status,
    })) as LiveBrawlScoreAssignment[],
    decisions: (decisions.data ?? []).map((row) => ({
      assignmentId: row.assignment_id, scorerActorId: row.scorer_actor_id, verdict: row.verdict,
      source: row.source, commandId: row.command_id,
    })) as LiveBrawlScoreDecision[],
    disputes: (disputes.data ?? []).map((row) => ({
      id: row.id, answerTargetId: row.answer_target_id, openedByActorId: row.opened_by_actor_id,
      status: row.status, finalVerdict: row.final_verdict, disputeEndsAt: row.dispute_ends_at,
    })) as LiveBrawlDispute[],
  };
}

export async function castLiveBrawlScore({ roomId, roundId, assignmentId, playerId, devicePlayerId, commandId, expectedRevision, verdict }: {
  assignmentId: string;
  commandId: string;
  devicePlayerId: string;
  expectedRevision: number;
  playerId: string;
  roomId: string;
  roundId: string;
  verdict: string;
}) {
  const { data, error } = await supabase.rpc('cast_live_brawl_score_command', {
    p_room_id: roomId, p_round_id: roundId, p_assignment_id: assignmentId, p_room_player_id: playerId,
    p_device_player_id: devicePlayerId, p_command_id: commandId, p_expected_revision: expectedRevision, p_verdict: verdict,
  });
  if (error) throw new Error(error.message);
  return data as { accepted: boolean; decisionId: string; duplicate: boolean };
}

export async function openLiveBrawlDispute({ roomId, roundId, answerTargetId, playerId, devicePlayerId, commandId }: {
  answerTargetId: string;
  commandId: string;
  devicePlayerId: string;
  playerId: string;
  roomId: string;
  roundId: string;
}) {
  const { data, error } = await supabase.rpc('open_live_brawl_dispute_command', {
    p_room_id: roomId, p_round_id: roundId, p_answer_target_id: answerTargetId, p_room_player_id: playerId,
    p_device_player_id: devicePlayerId, p_command_id: commandId,
  });
  if (error) throw new Error(error.message);
  return data as { accepted: boolean; disputeId: string; duplicate: boolean };
}

export async function castLiveBrawlDisputeVote({ roomId, disputeId, playerId, devicePlayerId, commandId, verdict }: {
  commandId: string;
  devicePlayerId: string;
  disputeId: string;
  playerId: string;
  roomId: string;
  verdict: string;
}) {
  const { data, error } = await supabase.rpc('cast_live_brawl_dispute_vote_command', {
    p_room_id: roomId, p_dispute_id: disputeId, p_room_player_id: playerId,
    p_device_player_id: devicePlayerId, p_command_id: commandId, p_verdict: verdict,
  });
  if (error) throw new Error(error.message);
  return data as { accepted: boolean; disputeId: string };
}

export async function completeLiveBrawlRound({ roomId, roundId, playerId, devicePlayerId, capability, commandId, expectedRevision, finishMatch }: {
  capability: string;
  commandId: string;
  devicePlayerId: string;
  expectedRevision: number;
  finishMatch: boolean;
  playerId: string;
  roomId: string;
  roundId: string;
}) {
  const { data, error } = await supabase.rpc('complete_live_brawl_round_command', {
    p_room_id: roomId, p_round_id: roundId, p_room_player_id: playerId, p_device_player_id: devicePlayerId,
    p_capability: capability, p_command_id: commandId, p_expected_revision: expectedRevision, p_finish_match: finishMatch,
  });
  if (error) throw new Error(error.message);
  return data as { accepted: boolean; duplicate: boolean; finish_match: boolean; revision: number; round_id: string };
}
