import { createVoteFlights, requireVoteResponse, voteFailure, VoteCommandError, type VoteReceipt } from './voteCommands';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { scoreAnswer, type AnswerVerdict } from '@animal-name-place/game-core';
import { DEFAULT_ROUND_SECONDS, type StarterCategory } from '@animal-name-place/shared';
import { getCompetitivePlayers } from './onlineRevealRules';
import { isWithinReconnectGrace, RECONNECT_GRACE_MS } from './reconnect';
import { supabase } from './supabase';

const DEVICE_PLAYER_ID_KEY = 'animal-name-place:device-player-id';
const PUBLIC_ROOM_TARGET_PLAYERS = 5;

export type OnlineRoomSettings = {
  activeModeLabel: string;
  activeModeRules: string;
  botCount: number;
  botDifficulty: 'Easy' | 'Normal' | 'Hard';
  categories: StarterCategory[];
  matchDurationSeconds?: number | null;
  roundSeconds: number;
  scoringOwner: 'Self' | 'Opponents';
  scoringStyle: 'Classic' | 'Strict';
  targetRounds: number;
};

export type RoomVisibility = 'private' | 'public';

export type OnlineRoomResult = {
  code: string;
  expiresAt: string;
  hostName: string;
  id: string;
  isHost: boolean;
  letterPickerName?: string;
  letterPickerPlayerId?: string;
  playerCount: number;
  playerId: string;
  playerNames: string[];
  playerName: string;
  settings: OnlineRoomSettings;
  setupLocked: boolean;
  status: RoomStatus;
  spectatorCount: number;
  visibility: RoomVisibility;
};

export type OnlineRoundResult = {
  endsAt?: string;
  id: string;
  letter: string;
  roundNumber: number;
  startedByPlayerId?: string;
  startedByPlayerName?: string;
  status?: 'active' | 'revealing';
};

export type OnlineAnswerSubmitResult = {
  answeredCount: number;
  score: number;
};

export type OnlineRoomSnapshot = {
  activeRound: OnlineRoundResult | null;
  expiresAt: string;
  hostName: string;
  hostPlayerId?: string;
  isExpired: boolean;
  letterPickerName?: string;
  letterPickerPlayerId?: string;
  playerCount: number;
  playerNames: string[];
  settings: OnlineRoomSettings;
  setupLocked: boolean;
  status: RoomStatus;
  spectatorCount: number;
  visibility: RoomVisibility;
};

export type OnlineResumeResult = OnlineRoomResult & {
  activeRound: OnlineRoundResult | null;
  answers: AnswersByCategory;
};

export type AnswersByCategory = Partial<Record<StarterCategory, string>>;
export type OnlineVoteVerdict = Exclude<AnswerVerdict, 'blank' | 'disputed'>;
export type OnlineRevealAnswer = {
  answer: string;
  assignedScorerPlayerId?: string;
  category: StarterCategory;
  dispute?: {
    botVoteCount: number;
    expectedVoteCount: number;
    finalVerdict?: OnlineVoteVerdict;
    id: string;
    isResolved: boolean;
    status: 'open' | 'resolved';
    votes: Array<{
      verdict: OnlineVoteVerdict;
      voterPlayerId: string;
    }>;
  };
  id: string;
  playerId: string;
  playerName: string;
  points: number;
  verdict: AnswerVerdict;
  votes: Array<{
    verdict: OnlineVoteVerdict;
    voterPlayerId: string;
  }>;
};
export type OnlineRoundScore = {
  answeredCount: number;
  playerId: string;
  playerName: string;
  score: number;
};
export type OnlineMatchStanding = {
  lastRoundScore: number;
  playerId: string;
  playerName: string;
  roundsPlayed: number;
  totalScore: number;
};
export type OnlinePlayerRoundSummary = {
  answeredCount: number;
  letter: string;
  roundId: string;
  roundNumber: number;
  score: number;
};
export type OnlineRevealSnapshot = {
  activePlayerCount: number;
  answers: OnlineRevealAnswer[];
  disputeEndsAt?: string | null;
  expectedVoteCount: number;
  openDisputeCount: number;
  pendingDisputeVoterNames: string[];
  isRoundReady: boolean;
  pendingSubmitterNames: string[];
  pendingVoterNames: string[];
  scoringEndsAt?: string | null;
  scores: OnlineRoundScore[];
  submittedPlayerCount: number;
  voteCount: number;
};
export type OnlineReportInput = {
  answerId?: string;
  details?: string;
  reason: string;
  reportedPlayerId?: string;
  reporterPlayerId?: string;
  roomId: string;
};

type RoomRow = {
  bot_count?: number;
  bot_difficulty?: 'Easy' | 'Normal' | 'Hard';
  categories?: StarterCategory[];
  code: string;
  empty_since?: string | null;
  expires_at: string;
  id: string;
  letter_picker_player_id?: string | null;
  match_duration_seconds?: number | null;
  match_revision?: number;
  matchmaking_bucket?: string;
  max_players?: number;
  min_client_version?: string;
  mode_label?: string;
  mode_rules?: string;
  round_seconds?: number;
  room_visibility?: RoomVisibility;
  ruleset_version?: number;
  scoring_owner?: 'Self' | 'Opponents';
  scoring_style?: 'Classic' | 'Strict';
  started_at?: string | null;
  status: RoomStatus;
  target_rounds?: number;
};

export type RoomStatus = 'lobby' | 'in_round' | 'revealing' | 'finished' | 'expired';

type RoundRow = {
  dispute_ends_at?: string | null;
  ends_at?: string | null;
  id: string;
  letter: string;
  revealed_at?: string | null;
  room_id?: string;
  round_number: number;
  scoring_ends_at?: string | null;
  started_by_player_id?: string | null;
  status?: 'active' | 'revealing';
};

type RoomPlayerRow = {
  display_name: string;
  id: string;
  is_host: boolean;
  joined_at?: string;
  last_seen_at?: string;
  role: 'player' | 'spectator';
  status?: 'active' | 'disconnected' | 'left' | 'kicked' | 'timed_out' | 'banned';
  left_at?: string | null;
};

type RoomPlayerStandingRow = RoomPlayerRow & {
  status: 'active' | 'disconnected' | 'left' | 'kicked' | 'timed_out' | 'banned';
};

type RoomPlayerResumeRow = RoomPlayerRow & {
  room_id: string;
};

type CreateRoomOptions = {
  expiresInMinutes?: number;
  matchmakingBucket?: string;
  maxPlayers?: number;
  minClientVersion?: string;
  rulesetVersion?: number;
  visibility?: RoomVisibility;
};

type AnswerRow = {
  answer_text: string;
  category: string;
  id: string;
  points?: number;
  room_player_id?: string;
  verdict: AnswerVerdict;
};

type VoteRow = {
  answer_id: string;
  verdict: OnlineVoteVerdict;
  voter_player_id: string;
};

type AnswerDisputeRow = {
  answer_id: string;
  final_verdict?: OnlineVoteVerdict | null;
  id: string;
  status: 'open' | 'resolved';
};

type AnswerDisputeVoteRow = {
  dispute_id: string;
  verdict: OnlineVoteVerdict;
  voter_player_id: string;
};

type RoundScoreRow = {
  answered_count: number;
  room_player_id: string;
  round_id?: string;
  score: number;
};

type LiveBrawlAdvanceRow = {
  bot_count: number;
  ends_at?: string | null;
  letter?: string | null;
  room_status: RoomStatus;
  round_id?: string | null;
  round_number?: number | null;
};

type StartRoundCommandResult = {
  accepted: boolean;
  duplicate: boolean;
  ends_at: string;
  letter: string;
  revision: number;
  round_id: string;
  round_number: number;
};

type CompleteRoundCommandResult = {
  accepted: boolean;
  duplicate: boolean;
  finish_match: boolean;
  revision: number;
  room_status: RoomStatus;
  round_id: string;
};

function createDevicePlayerId() {
  return `device_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
}

async function getDevicePlayerId() {
  const existingId = await AsyncStorage.getItem(DEVICE_PLAYER_ID_KEY);

  if (existingId) {
    return existingId;
  }

  const nextId = createDevicePlayerId();
  await AsyncStorage.setItem(DEVICE_PLAYER_ID_KEY, nextId);
  return nextId;
}

function createCommandId() {
  const randomUuid = globalThis.crypto?.randomUUID;

  if (randomUuid) {
    return randomUuid.call(globalThis.crypto);
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

async function getAuthoritativeRoundContext(roundId: string, forVote = false) {
  const { data: round, error: roundError, status: roundStatus } = await supabase
    .from('rounds')
    .select('room_id')
    .eq('id', roundId)
    .single<{ room_id: string }>();

  if (roundError) {
    if (forVote) throw new VoteCommandError(roundError.message, 'round-context', 'rejected', roundStatus, roundError);
    throw new Error(roundError.message);
  }

  const { data: room, error: roomError, status: roomStatus } = await supabase
    .from('rooms')
    .select('match_revision')
    .eq('id', round.room_id)
    .single<Pick<RoomRow, 'match_revision'>>();

  if (roomError) {
    if (forVote) throw new VoteCommandError(roomError.message, 'room-context', 'rejected', roomStatus, roomError);
    throw new Error(roomError.message);
  }

  return {
    devicePlayerId: await getDevicePlayerId(),
    expectedRevision: room.match_revision ?? 0,
    roomId: round.room_id,
  };
}

async function getAuthoritativeRoomContext(roomId: string) {
  const { data: room, error } = await supabase
    .from('rooms')
    .select('match_revision')
    .eq('id', roomId)
    .single<Pick<RoomRow, 'match_revision'>>();

  if (error) {
    throw new Error(error.message);
  }

  return {
    devicePlayerId: await getDevicePlayerId(),
    expectedRevision: room.match_revision ?? 0,
  };
}

async function getRoomPlayers(roomId: string) {
  const { data, error } = await supabase
    .from('room_players')
    .select('id, display_name, is_host, joined_at, last_seen_at, left_at, role, status')
    .eq('room_id', roomId)
    .in('status', ['active', 'disconnected'])
    .order('joined_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  // A short disconnect still occupies the original seat. This keeps the
  // player id (and therefore answers, scores and votes) stable while the
  // app is briefly backgrounded or the connection drops.
  return ((data ?? []) as RoomPlayerRow[]).filter((player) => isWithinReconnectGrace(player));
}

async function getRoomPlayersForStandings(roomId: string) {
  const { data, error } = await supabase
    .from('room_players')
    .select('id, display_name, is_host, joined_at, role, status')
    .eq('room_id', roomId)
    .eq('role', 'player')
    .neq('status', 'banned')
    .order('joined_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as RoomPlayerStandingRow[];
}

function getRoomCounts(players: RoomPlayerRow[]) {
  return {
    playerCount: players.filter((player) => player.role === 'player').length,
    spectatorCount: players.filter((player) => player.role === 'spectator').length,
  };
}

function getRoomPlayerNames(players: RoomPlayerRow[]) {
  return players
    .filter((player) => player.role === 'player')
    .map((player) => player.display_name);
}

function getDefaultRoomSettings(roundSeconds = DEFAULT_ROUND_SECONDS): OnlineRoomSettings {
  return {
    activeModeLabel: 'Custom',
    activeModeRules: 'Set categories, CPUs, rounds, timer, and scoring before play.',
    botCount: 0,
    botDifficulty: 'Normal',
    categories: ['Name', 'Place', 'Animal', 'Food', 'Object', 'Job', 'Brand'],
    matchDurationSeconds: null,
    roundSeconds,
    scoringOwner: 'Opponents',
    scoringStyle: 'Classic',
    targetRounds: 3,
  };
}

function deserializeRoomSettings(room: Partial<RoomRow>): OnlineRoomSettings {
  const fallback = getDefaultRoomSettings(room.round_seconds ?? DEFAULT_ROUND_SECONDS);

  return {
    activeModeLabel: room.mode_label ?? fallback.activeModeLabel,
    activeModeRules: room.mode_rules ?? fallback.activeModeRules,
    botCount: room.bot_count ?? fallback.botCount,
    botDifficulty: room.bot_difficulty ?? fallback.botDifficulty,
    categories: room.categories?.length ? room.categories : fallback.categories,
    matchDurationSeconds: room.match_duration_seconds ?? null,
    roundSeconds: room.round_seconds ?? fallback.roundSeconds,
    scoringOwner: room.scoring_owner ?? fallback.scoringOwner,
    scoringStyle: room.scoring_style ?? fallback.scoringStyle,
    targetRounds: room.target_rounds ?? fallback.targetRounds,
  };
}

function serializeRoomSettings(settings: OnlineRoomSettings) {
  return {
    bot_count: settings.botCount,
    bot_difficulty: settings.botDifficulty,
    categories: settings.categories,
    match_duration_seconds: settings.matchDurationSeconds ?? null,
    mode_label: settings.activeModeLabel,
    mode_rules: settings.activeModeRules,
    round_seconds: settings.roundSeconds,
    scoring_owner: settings.scoringOwner,
    scoring_style: settings.scoringStyle,
    target_rounds: settings.targetRounds,
  };
}

const ROOM_SELECT_FIELDS = 'id, code, expires_at, status, letter_picker_player_id, started_at, round_seconds, room_visibility, matchmaking_bucket, ruleset_version, min_client_version, max_players, mode_label, mode_rules, bot_count, bot_difficulty, categories, match_duration_seconds, target_rounds, scoring_owner, scoring_style';

function getHostName(players: RoomPlayerRow[], fallback: string) {
  return players.find((player) => player.is_host)?.display_name ?? fallback;
}

function getHostPlayer(players: RoomPlayerRow[]) {
  return players.find((player) => player.is_host) ?? players[0];
}

function wasPlayerSeenRecently(player?: RoomPlayerRow, staleAfterMs = 20_000) {
  if (!player?.last_seen_at) {
    return false;
  }

  return Date.now() - new Date(player.last_seen_at).getTime() <= staleAfterMs;
}

function getTurnPlayers(players: RoomPlayerRow[]) {
  return players.filter((player) => player.role === 'player');
}

function chooseLetterPicker(players: RoomPlayerRow[], currentPickerId?: string | null) {
  const turnPlayers = getTurnPlayers(players);

  if (!turnPlayers.length) {
    return undefined;
  }

  return turnPlayers.find((player) => player.id === currentPickerId) ?? turnPlayers[0];
}

function chooseNextLetterPicker(players: RoomPlayerRow[], currentPickerId?: string | null) {
  const turnPlayers = getTurnPlayers(players);

  if (!turnPlayers.length) {
    return undefined;
  }

  const currentIndex = Math.max(0, turnPlayers.findIndex((player) => player.id === currentPickerId));
  return turnPlayers[(currentIndex + 1) % turnPlayers.length];
}

async function ensureOnlineRoomHost(roomId: string) {
  const players = await getRoomPlayers(roomId);
  const hostPlayer = getHostPlayer(players);

  if (!hostPlayer) {
    return {
      hostName: 'Waiting for host',
      hostPlayerId: undefined,
      players,
    };
  }


  return {
    hostName: hostPlayer.display_name,
    hostPlayerId: hostPlayer.id,
    players,
  };
}

async function ensureOnlineLetterPicker(roomId: string, currentPickerId?: string | null) {
  const players = await getRoomPlayers(roomId);
  const picker = chooseLetterPicker(players, currentPickerId);

  if (picker && picker.id !== currentPickerId) {
    const { error } = await supabase
      .from('rooms')
      .update({ letter_picker_player_id: picker.id })
      .eq('id', roomId);

    if (error) {
      throw new Error(error.message);
    }
  }

  return {
    picker,
    players,
  };
}

async function assertHost(playerId: string) {
  const { data, error } = await supabase
    .from('room_players')
    .select('is_host')
    .eq('id', playerId)
    .single<{ is_host: boolean }>();

  if (error) {
    throw new Error(error.message);
  }

  if (!data.is_host) {
    throw new Error('Only the host can do that.');
  }
}

async function assertLetterPicker(roomId: string, playerId: string) {
  const { data: room, error } = await supabase
    .from('rooms')
    .select('letter_picker_player_id')
    .eq('id', roomId)
    .single<Pick<RoomRow, 'letter_picker_player_id'>>();

  if (error) {
    throw new Error(error.message);
  }

  const { picker } = await ensureOnlineLetterPicker(roomId, room.letter_picker_player_id);

  if (picker && picker.id !== playerId) {
    throw new Error(`${picker.display_name} picks the next letter.`);
  }
}

async function upsertOnlineRoundScore(roundId: string, playerId: string) {
  const { data, error } = await supabase
    .from('answers')
    .select('answer_text, category, id, verdict')
    .eq('round_id', roundId)
    .eq('room_player_id', playerId);

  if (error) {
    throw new Error(error.message);
  }

  const answers = (data ?? []) as AnswerRow[];
  const answeredCount = answers.filter((answer) => answer.answer_text.trim()).length;
  const score = answers.reduce((total, answer) => total + scoreAnswer({ verdict: answer.verdict }), 0);
  const invalidStreak = answers.filter((answer) => answer.verdict === 'invalid').length;

  const { error: scoreError } = await supabase
    .from('round_scores')
    .upsert({
      answered_count: answeredCount,
      invalid_streak: invalidStreak,
      penalty_points: 0,
      room_player_id: playerId,
      round_id: roundId,
      score,
    }, {
      onConflict: 'round_id,room_player_id',
    });

  if (scoreError) {
    throw new Error(scoreError.message);
  }

  return {
    answeredCount,
    score,
  };
}

async function getAnswerId(roundId: string, playerId: string, category: StarterCategory) {
  const { data, error, status } = await supabase
    .from('answers')
    .select('id')
    .eq('round_id', roundId)
    .eq('room_player_id', playerId)
    .eq('category', category)
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new VoteCommandError(error.message, 'answer-lookup', 'rejected', status, error);
  }

  return data?.id ?? null;
}

function getPlayerNameMap(players: RoomPlayerRow[]) {
  return Object.fromEntries(players.map((player) => [player.id, player.display_name]));
}

async function clearRoomEmptySince(roomId: string) {
  const { error } = await supabase
    .from('rooms')
    .update({ empty_since: null })
    .eq('id', roomId);

  if (error) {
    throw new Error(error.message);
  }
}

async function touchRoomPlayer(playerId: string) {
  const { error } = await supabase
    .from('room_players')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', playerId);

  if (error) {
    throw new Error(error.message);
  }
}

class ResumeCandidateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResumeCandidateUnavailableError';
  }
}

function isExpectedResumeFailure(error: unknown) {
  if (error instanceof ResumeCandidateUnavailableError) {
    return true;
  }

  const message = error instanceof Error ? error.message.toLowerCase() : '';
  return message === 'room not found or expired.'
    || message === 'reconnect window expired'
    || message === 'room permission denied.';
}

async function touchResumedRoomPlayer(playerId: string, roomId: string) {
  const { data, error } = await supabase
    .from('room_players')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', playerId)
    .eq('room_id', roomId)
    .eq('status', 'active')
    .select('id')
    .maybeSingle<{ id: string }>();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    throw new ResumeCandidateUnavailableError('The room seat is no longer active.');
  }
}

async function reactivateResumedRoomPlayer(
  room: RoomRow,
  roomPlayer: RoomPlayerResumeRow,
  devicePlayerId: string,
  capabilities: Record<string, string>,
) {
  const capability = capabilities[roomPlayer.id];

  if (!capability) {
    throw new ResumeCandidateUnavailableError('This older room has no management credential.');
  }

  const { error } = await supabase.rpc('join_managed_room', {
    p_code: room.code,
    p_device_player_id: devicePlayerId,
    p_display_name: roomPlayer.display_name,
    p_capabilities: { [roomPlayer.id]: capability },
  });

  if (error) {
    if (isExpectedResumeFailure(new Error(error.message))) {
      throw new ResumeCandidateUnavailableError(error.message);
    }
    throw new Error(error.message);
  }
}

export type ForegroundSeatRecoveryResult =
  | { status: 'active' }
  | { reason: string; status: 'unavailable' };

let foregroundRecoveryInFlight: Promise<ForegroundSeatRecoveryResult> | null = null;
let roomLeaveInFlight = false;
let roomLifecycleEpoch = 0;

export async function recoverOnlineRoomPlayer({
  roomId,
  playerId,
  displayName,
}: {
  roomId: string;
  playerId: string;
  displayName?: string;
}): Promise<ForegroundSeatRecoveryResult> {
  if (roomLeaveInFlight) {
    return { reason: 'The room is closing.', status: 'unavailable' };
  }

  if (foregroundRecoveryInFlight) {
    return foregroundRecoveryInFlight;
  }

  const epoch = roomLifecycleEpoch;
  const request: Promise<ForegroundSeatRecoveryResult> = (async () => {
    const { data: room, error: roomError } = await supabase
      .from('rooms')
      .select('id, code, expires_at, status')
      .eq('id', roomId)
      .not('status', 'in', '("finished","expired")')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle<Pick<RoomRow, 'id' | 'code' | 'expires_at' | 'status'>>();

    if (roomError) {
      throw new Error(roomError.message);
    }

    if (!room) {
      return { reason: 'The room is no longer resumable.', status: 'unavailable' };
    }

    const capability = (await getRoomCapabilities())[playerId];
    if (!capability) {
      return { reason: 'This room has no management credential.', status: 'unavailable' };
    }

    if (epoch !== roomLifecycleEpoch || roomLeaveInFlight) {
      return { reason: 'The room recovery request is stale.', status: 'unavailable' };
    }

    const { error } = await supabase.rpc('join_managed_room', {
      p_code: room.code,
      p_device_player_id: await getDevicePlayerId(),
      p_display_name: displayName?.trim() ?? '',
      p_capabilities: { [playerId]: capability },
    });

    if (error) {
      if (isExpectedResumeFailure(new Error(error.message))) {
        return { reason: error.message, status: 'unavailable' };
      }
      throw new Error(error.message);
    }

    return { status: 'active' };
  })();

  foregroundRecoveryInFlight = request;
  request.then(
    () => { if (foregroundRecoveryInFlight === request) foregroundRecoveryInFlight = null; },
    () => { if (foregroundRecoveryInFlight === request) foregroundRecoveryInFlight = null; },
  );
  return request;
}

async function getLatestActiveRound(roomId: string, players: RoomPlayerRow[] = []): Promise<OnlineRoundResult | null> {
  const { data: latestRound, error } = await supabase
    .from('rounds')
    .select('id, letter, round_number, status, ends_at, started_by_player_id')
    .eq('room_id', roomId)
    .in('status', ['active', 'revealing'])
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle<RoundRow>();

  if (error) {
    throw new Error(error.message);
  }

  return latestRound
    ? {
      endsAt: latestRound.ends_at ?? undefined,
      id: latestRound.id,
      letter: latestRound.letter,
      roundNumber: latestRound.round_number,
      startedByPlayerId: latestRound.started_by_player_id ?? undefined,
      startedByPlayerName: players.find((player) => player.id === latestRound.started_by_player_id)?.display_name,
      status: latestRound.status,
    }
    : null;
}

async function buildOnlineRoomResult(room: RoomRow, playerId: string, fallbackName: string): Promise<OnlineRoomResult> {
  const hostState = await ensureOnlineRoomHost(room.id);
  const counts = getRoomCounts(hostState.players);
  const player = hostState.players.find((roomPlayer) => roomPlayer.id === playerId);
  const picker = chooseLetterPicker(hostState.players, room.letter_picker_player_id);

  return {
    code: room.code,
    expiresAt: room.expires_at,
    hostName: hostState.hostName,
    id: room.id,
    isHost: hostState.hostPlayerId === playerId,
    letterPickerName: picker?.display_name,
    letterPickerPlayerId: picker?.id,
    playerCount: counts.playerCount,
    playerId,
    playerNames: getRoomPlayerNames(hostState.players),
    playerName: player?.display_name ?? fallbackName,
    settings: deserializeRoomSettings(room),
    setupLocked: Boolean(room.started_at),
    status: room.status,
    spectatorCount: counts.spectatorCount,
    visibility: room.room_visibility ?? 'private',
  };
}

export async function getOnlinePlayerAnswers(roundId: string, playerId: string): Promise<AnswersByCategory> {
  const { data, error } = await supabase
    .from('answers')
    .select('answer_text, category')
    .eq('round_id', roundId)
    .eq('room_player_id', playerId);

  if (error) {
    throw new Error(error.message);
  }

  return Object.fromEntries((data ?? []).map((answer) => [
    answer.category as StarterCategory,
    answer.answer_text,
  ])) as AnswersByCategory;
}

export async function saveOnlineDraftAnswer({
  answer: _answer,
  category: _category,
  playerId: _playerId,
  roundId: _roundId,
}: {
  answer: string;
  category: StarterCategory;
  playerId: string;
  roundId: string;
}) {
  // Drafts are intentionally local-only for competitive online play. The
  // server only accepts locked answer submissions through submit_answer_command.
}

async function resumeOnlineRoomOnce(): Promise<OnlineResumeResult | null> {
  const devicePlayerId = await getDevicePlayerId();
  const capabilities = await getRoomCapabilities();

  const { data: roomPlayers, error: roomPlayersError } = await supabase
    .from('room_players')
    .select('id, room_id, display_name, is_host, joined_at, role, status, left_at')
    .eq('device_player_id', devicePlayerId)
    .order('last_seen_at', { ascending: false });

  if (roomPlayersError) {
    throw new Error(roomPlayersError.message);
  }

  for (const roomPlayer of (roomPlayers ?? []) as RoomPlayerResumeRow[]) {
    if (!isWithinReconnectGrace(roomPlayer)) {
      continue;
    }

    try {
      const { data: room, error: roomError } = await supabase
        .from('rooms')
        .select(ROOM_SELECT_FIELDS)
        .eq('id', roomPlayer.room_id)
        .not('status', 'in', '("finished","expired")')
        .gt('expires_at', new Date().toISOString())
        .maybeSingle<RoomRow>();

      if (roomError) {
        throw new Error(roomError.message);
      }

      if (!room) {
        continue;
      }

      const activeRound = await getLatestActiveRound(room.id);
      const baseRoom = await buildOnlineRoomResult(room, roomPlayer.id, roomPlayer.display_name);
      const answers = activeRound
        ? await getOnlinePlayerAnswers(activeRound.id, roomPlayer.id)
        : {};

      if (roomPlayer.status === 'disconnected') {
        await reactivateResumedRoomPlayer(room, roomPlayer, devicePlayerId, capabilities);
      } else {
        await touchResumedRoomPlayer(roomPlayer.id, room.id);
      }

      return {
        ...baseRoom,
        activeRound,
        answers,
      };
    } catch (error) {
      if (isExpectedResumeFailure(error)) {
        continue;
      }
      throw error;
    }
  }

  return null;
}

let resumeOnlineRoomInFlight: Promise<OnlineResumeResult | null> | null = null;

export function resumeOnlineRoom(): Promise<OnlineResumeResult | null> {
  if (resumeOnlineRoomInFlight) {
    return resumeOnlineRoomInFlight;
  }

  const request = resumeOnlineRoomOnce();
  resumeOnlineRoomInFlight = request;
  request.then(
    () => { if (resumeOnlineRoomInFlight === request) resumeOnlineRoomInFlight = null; },
    () => { if (resumeOnlineRoomInFlight === request) resumeOnlineRoomInFlight = null; },
  );
  return request;
}

export async function createOnlineRoom(
  displayName: string,
  settings: OnlineRoomSettings = getDefaultRoomSettings(),
  options: CreateRoomOptions = {},
): Promise<OnlineRoomResult> {
  const { data, error } = await supabase.rpc('create_managed_room', {
    p_device_player_id: await getDevicePlayerId(), p_display_name: displayName.trim(),
    p_settings: serializeRoomSettings(settings), p_options: options,
  });
  if (error) throw new Error(error.message);
  return finishManagedRoom(data as ManagedRoomResult, displayName);
}

export async function joinOnlineRoom(code: string, displayName: string): Promise<OnlineRoomResult> {
  const { data, error } = await supabase.rpc('join_managed_room', {
    p_code: code, p_device_player_id: await getDevicePlayerId(), p_display_name: displayName.trim(),
    p_capabilities: await getRoomCapabilities(),
  });
  if (error) throw new Error(error.message);
  return finishManagedRoom(data as ManagedRoomResult, displayName);
}

async function findOrCreatePublicRoomCommand(
  displayName: string,
  settings: OnlineRoomSettings,
  options: {
    matchmakingBucket: string;
    maxPlayers?: number;
    minClientVersion: string;
    rulesetVersion: number;
  },
): Promise<OnlineRoomResult> {
  const { data, error } = await supabase.rpc('find_or_create_public_room', {
    p_device_player_id: await getDevicePlayerId(), p_display_name: displayName.trim(),
    p_settings: serializeRoomSettings(settings), p_options: options,
    p_capabilities: await getRoomCapabilities(),
  });
  if (error) throw new Error(error.message);
  return finishManagedRoom(data as ManagedRoomResult, displayName);
}

async function finishRoomIfStillEmpty(roomId: string) {
  const players = await getRoomPlayers(roomId);

  if (players.length > 0) {
    return;
  }

  const endedAt = new Date().toISOString();
  const { error } = await supabase
    .from('rooms')
    .update({
      ended_at: endedAt,
      empty_since: null,
      letter_picker_player_id: null,
      status: 'finished',
    })
    .eq('id', roomId)
    .not('status', 'in', '("finished","expired")');

  if (error) {
    throw new Error(error.message);
  }
}

export async function leaveOnlineRoom(playerId: string) {
  roomLeaveInFlight = true;
  roomLifecycleEpoch += 1;

  try {
    if (foregroundRecoveryInFlight) {
      await foregroundRecoveryInFlight.catch(() => undefined);
    }

    const { data: leavingPlayer, error: leavingPlayerError } = await supabase
      .from('room_players')
      .select('room_id')
      .eq('id', playerId)
      .maybeSingle<{ room_id: string }>();

    if (leavingPlayerError) {
      throw new Error(leavingPlayerError.message);
    }

    const leftAt = new Date().toISOString();
    const { error } = await supabase
      .from('room_players')
      .update({
        last_seen_at: leftAt,
        left_at: leftAt,
        status: 'disconnected',
      })
      .eq('id', playerId);

    if (error) {
      throw new Error(error.message);
    }

    setTimeout(() => {
      supabase
        .from('room_players')
        .update({ status: 'left' })
        .eq('id', playerId)
        .eq('status', 'disconnected')
        .lte('left_at', new Date(Date.now() - RECONNECT_GRACE_MS).toISOString())
        .then(() => undefined);
    }, RECONNECT_GRACE_MS);

    if (leavingPlayer?.room_id) {
      const players = await getRoomPlayers(leavingPlayer.room_id);

      if (players.length) {
        await clearRoomEmptySince(leavingPlayer.room_id);
        await ensureOnlineRoomHost(leavingPlayer.room_id);
        return;
      }

      const emptySince = new Date().toISOString();
      await supabase
        .from('rooms')
        .update({ empty_since: emptySince })
        .eq('id', leavingPlayer.room_id)
        .is('empty_since', null)
        .not('status', 'in', '("finished","expired")');

      setTimeout(() => {
        finishRoomIfStillEmpty(leavingPlayer.room_id).catch(() => undefined);
      }, 30000);
    }
  } finally {
    roomLeaveInFlight = false;
  }
}

export async function markOnlineRoomPlayerDisconnected(playerId: string) {
  if (roomLeaveInFlight) return;

  const disconnectedAt = new Date().toISOString();
  const { error } = await supabase
    .from('room_players')
    .update({ last_seen_at: disconnectedAt, left_at: disconnectedAt, status: 'disconnected' })
    .eq('id', playerId)
    .eq('status', 'active');

  if (error) {
    throw new Error(error.message);
  }
}

export async function startOnlineRound({
  letter,
  playerId,
  roundSeconds = DEFAULT_ROUND_SECONDS,
  roomId,
}: {
  letter: string;
  playerId: string;
  roundSeconds?: number;
  roomId: string;
}): Promise<OnlineRoundResult> {
  const { devicePlayerId, expectedRevision } = await getAuthoritativeRoomContext(roomId);
  const { data, error } = await supabase.rpc('start_online_round_command', {
    p_capability: await getRoomCapability(playerId),
    p_command_id: createCommandId(),
    p_device_player_id: devicePlayerId,
    p_expected_revision: expectedRevision,
    p_letter: letter,
    p_room_id: roomId,
    p_room_player_id: playerId,
    p_round_seconds: roundSeconds,
  });

  if (error) {
    throw new Error(error.message);
  }

  const round = data as StartRoundCommandResult;
  return {
    endsAt: round.ends_at,
    id: round.round_id,
    letter: round.letter,
    roundNumber: round.round_number,
    startedByPlayerId: playerId,
    status: 'active',
  };
}

export async function advanceLiveBrawlSession({
  letter,
  playerId,
  roomId,
  roundSeconds = DEFAULT_ROUND_SECONDS,
  targetPlayers = PUBLIC_ROOM_TARGET_PLAYERS,
}: {
  letter: string;
  playerId: string;
  roomId: string;
  roundSeconds?: number;
  targetPlayers?: number;
}): Promise<{
  botCount: number;
  roomStatus: RoomStatus;
  round: OnlineRoundResult | null;
}> {
  const { data, error } = await supabase
    .rpc('advance_live_brawl_session', {
      p_letter: letter,
      p_device_player_id: await getDevicePlayerId(),
      p_capability: await getRoomCapability(playerId),
      p_player_id: playerId,
      p_room_id: roomId,
      p_round_seconds: roundSeconds,
      p_target_players: targetPlayers,
    })
    .single<LiveBrawlAdvanceRow>();

  if (error) {
    throw new Error(error.message);
  }

  return {
    botCount: data.bot_count,
    roomStatus: data.room_status,
    round: data.round_id && data.letter && data.round_number
      ? {
        endsAt: data.ends_at ?? undefined,
        id: data.round_id,
        letter: data.letter,
        roundNumber: data.round_number,
        startedByPlayerId: playerId,
        status: data.room_status === 'revealing' ? 'revealing' : 'active',
      }
      : null,
  };
}

export async function getOnlineRoomSnapshot(roomId: string, playerId?: string): Promise<OnlineRoomSnapshot> {
  if (playerId) {
    await touchRoomPlayer(playerId);
  }

  const { data: room, error: roomError } = await supabase
    .from('rooms')
    .select('empty_since, expires_at, status, letter_picker_player_id, started_at, round_seconds, room_visibility, mode_label, mode_rules, bot_count, bot_difficulty, categories, match_duration_seconds, target_rounds, scoring_owner, scoring_style')
    .eq('id', roomId)
    .single<Pick<RoomRow, 'bot_count' | 'bot_difficulty' | 'categories' | 'empty_since' | 'expires_at' | 'letter_picker_player_id' | 'match_duration_seconds' | 'mode_label' | 'mode_rules' | 'room_visibility' | 'round_seconds' | 'scoring_owner' | 'scoring_style' | 'started_at' | 'status' | 'target_rounds'>>();

  if (roomError) {
    throw new Error(roomError.message);
  }

  const isExpired = new Date(room.expires_at).getTime() <= Date.now() || room.status === 'expired';

  if (isExpired && room.status !== 'expired') {
    const { error: expireError } = await supabase
      .from('rooms')
      .update({
        ended_at: new Date().toISOString(),
        status: 'expired',
      })
      .eq('id', roomId);

    if (expireError) {
      throw new Error(expireError.message);
    }
  }

  const hostState = await ensureOnlineRoomHost(roomId);
  const players = hostState.players;
  if (!players.length && room.empty_since && Date.now() - new Date(room.empty_since).getTime() >= 30000) {
    await finishRoomIfStillEmpty(roomId);
  }

  const counts = getRoomCounts(players);
  const picker = chooseLetterPicker(players, room.letter_picker_player_id);

  const latestRound = await getLatestActiveRound(roomId, players);

  return {
    activeRound: latestRound,
    expiresAt: room.expires_at,
    hostName: hostState.hostName,
    hostPlayerId: hostState.hostPlayerId,
    isExpired,
    letterPickerName: picker?.display_name,
    letterPickerPlayerId: picker?.id,
    playerCount: counts.playerCount,
    playerNames: getRoomPlayerNames(players),
    settings: deserializeRoomSettings(room),
    setupLocked: Boolean(room.started_at),
    status: isExpired ? 'expired' : room.status,
    spectatorCount: counts.spectatorCount,
    visibility: room.room_visibility ?? 'private',
  };
}

export async function updateOnlineRoomSettings({
  playerId,
  roomId,
  settings,
}: {
  playerId: string;
  roomId: string;
  settings: OnlineRoomSettings;
}) {
  const { error } = await supabase.rpc('update_online_room_settings', {
    p_room_id: roomId, p_player_id: playerId,
    p_device_player_id: await getDevicePlayerId(),
    p_capability: await getRoomCapability(playerId),
    p_settings: serializeRoomSettings(settings),
  });
  if (error) throw new Error(error.message);
}

export async function getOnlineRevealSnapshot(roomId: string, roundId: string): Promise<OnlineRevealSnapshot> {
  const players = await getRoomPlayers(roomId);
  const competitivePlayers = getCompetitivePlayers(players);
  const playerNames = getPlayerNameMap(players);
  const activePlayerIds = competitivePlayers.map((player) => player.id);
  const { data: roundData, error: roundError } = await supabase
    .from('rounds')
    .select('scoring_ends_at, dispute_ends_at')
    .eq('id', roundId)
    .eq('room_id', roomId)
    .single<Pick<RoundRow, 'dispute_ends_at' | 'scoring_ends_at'>>();

  if (roundError) {
    throw new Error(roundError.message);
  }

  const { data: roomData, error: roomError } = await supabase
    .from('rooms')
    .select('bot_count')
    .eq('id', roomId)
    .single<Pick<RoomRow, 'bot_count'>>();

  if (roomError) {
    throw new Error(roomError.message);
  }

  const roomBotCount = roomData.bot_count ?? 0;
  const hasRoomBots = roomBotCount > 0;

  const { data: answersData, error: answersError } = await supabase
    .from('answers')
    .select('answer_text, category, id, points, room_player_id, verdict')
    .eq('round_id', roundId);

  if (answersError) {
    throw new Error(answersError.message);
  }

  const answers = (answersData ?? []) as Array<AnswerRow & {
    points: number;
    room_player_id: string;
  }>;
  const answerIds = answers.map((answer) => answer.id);
  const { data: votesData, error: votesError } = answerIds.length
    ? await supabase
      .from('votes')
      .select('answer_id, verdict, voter_player_id')
      .in('answer_id', answerIds)
    : { data: [], error: null };

  if (votesError) {
    throw new Error(votesError.message);
  }

  const votes = (votesData ?? []) as VoteRow[];
  const votesByAnswerId = votes.reduce<Record<string, OnlineRevealAnswer['votes']>>((groupedVotes, vote) => {
    groupedVotes[vote.answer_id] = [
      ...(groupedVotes[vote.answer_id] ?? []),
      {
        verdict: vote.verdict,
        voterPlayerId: vote.voter_player_id,
      },
    ];

    return groupedVotes;
  }, {});
  const { data: disputeData, error: disputeError } = answerIds.length
    ? await supabase
      .from('answer_disputes')
      .select('answer_id, final_verdict, id, status')
      .in('answer_id', answerIds)
    : { data: [], error: null };

  if (disputeError) {
    throw new Error(disputeError.message);
  }

  const disputes = (disputeData ?? []) as AnswerDisputeRow[];
  const disputeIds = disputes.map((dispute) => dispute.id);
  const { data: disputeVotesData, error: disputeVotesError } = disputeIds.length
    ? await supabase
      .from('answer_dispute_votes')
      .select('dispute_id, verdict, voter_player_id')
      .in('dispute_id', disputeIds)
    : { data: [], error: null };

  if (disputeVotesError) {
    throw new Error(disputeVotesError.message);
  }

  const disputeVotes = (disputeVotesData ?? []) as AnswerDisputeVoteRow[];
  const disputeByAnswerId = Object.fromEntries(disputes.map((dispute) => [dispute.answer_id, dispute]));
  const disputeVotesByDisputeId = disputeVotes.reduce<Record<string, NonNullable<OnlineRevealAnswer['dispute']>['votes']>>((groupedVotes, vote) => {
    groupedVotes[vote.dispute_id] = [
      ...(groupedVotes[vote.dispute_id] ?? []),
      {
        verdict: vote.verdict,
        voterPlayerId: vote.voter_player_id,
      },
    ];

    return groupedVotes;
  }, {});

  const { data: scoresData, error: scoresError } = await supabase
    .from('round_scores')
    .select('answered_count, room_player_id, score')
    .eq('round_id', roundId);

  if (scoresError) {
    throw new Error(scoresError.message);
  }

  const scores = ((scoresData ?? []) as RoundScoreRow[])
    .map((score) => ({
      answeredCount: score.answered_count,
      playerId: score.room_player_id,
      playerName: playerNames[score.room_player_id] ?? 'Player',
      score: score.score,
    }))
    .sort((a, b) => b.score - a.score);
  const submittedPlayerIds = new Set(scores.map((score) => score.playerId));
  const submittedPlayerCount = submittedPlayerIds.size;
  const votableAnswers = answers.filter((answer) => answer.answer_text.trim());
  const activePlayerIdSet = new Set(activePlayerIds);
  const answerOwnerById = Object.fromEntries(answers.map((answer) => [answer.id, answer.room_player_id]));
  const assignedScorerByAnswerId = Object.fromEntries(votableAnswers.map((answer) => {
    const ownerIndex = activePlayerIds.indexOf(answer.room_player_id);
    const assignedScorerId = activePlayerIds.length > 1
      ? activePlayerIds[(ownerIndex + 1 + activePlayerIds.length) % activePlayerIds.length]
      : undefined;

    return [answer.id, assignedScorerId === answer.room_player_id ? undefined : assignedScorerId];
  }));
  const voteKeySet = new Set(votes.map((vote) => `${vote.answer_id}:${vote.voter_player_id}`));
  const expectedVoteCount = votableAnswers.reduce((count, answer) => (
    count + activePlayerIds.filter((playerId) => playerId !== answer.room_player_id).length
  ), 0);
  const voteCount = votes.filter((vote) => (
    activePlayerIdSet.has(vote.voter_player_id)
    && answerOwnerById[vote.answer_id] !== vote.voter_player_id
  )).length;
  const openDisputes = disputes.filter((dispute) => dispute.status === 'open');
  const openDisputeCount = openDisputes.length;
  const pendingDisputeVoterIds = new Set<string>();

  openDisputes.forEach((dispute) => {
    const disputeVoteKeySet = new Set((disputeVotesByDisputeId[dispute.id] ?? []).map((vote) => vote.voterPlayerId));

    activePlayerIds.forEach((playerId) => {
      if (!disputeVoteKeySet.has(playerId)) {
        pendingDisputeVoterIds.add(playerId);
      }
    });
  });
  const isRoundReady = activePlayerIds.length > 0
    && submittedPlayerCount >= activePlayerIds.length
    && voteCount >= expectedVoteCount
    && openDisputeCount === 0;
  const pendingSubmitterNames = competitivePlayers
    .filter((player) => !submittedPlayerIds.has(player.id))
    .map((player) => player.display_name);
  const pendingVoterIds = new Set<string>();

  for (const playerId of activePlayerIds) {
    if (!submittedPlayerIds.has(playerId)) {
      continue;
    }

    const hasMissingVote = votableAnswers.some((answer) => (
      answer.room_player_id !== playerId && !voteKeySet.has(`${answer.id}:${playerId}`)
    ));

    if (hasMissingVote) {
      pendingVoterIds.add(playerId);
    }
  }

  const pendingVoterNames = competitivePlayers
    .filter((player) => pendingVoterIds.has(player.id))
    .map((player) => player.display_name);
  const pendingDisputeVoterNames = competitivePlayers
    .filter((player) => pendingDisputeVoterIds.has(player.id))
    .map((player) => player.display_name);

  return {
    activePlayerCount: activePlayerIds.length,
    answers: answers.map((answer) => {
      const dispute = disputeByAnswerId[answer.id];
      const disputeVotesForAnswer = dispute ? disputeVotesByDisputeId[dispute.id] ?? [] : [];

      return {
        answer: answer.answer_text,
        assignedScorerPlayerId: assignedScorerByAnswerId[answer.id],
        category: answer.category as StarterCategory,
        dispute: dispute
          ? {
            botVoteCount: roomBotCount,
            expectedVoteCount: activePlayerIds.length + roomBotCount,
            finalVerdict: dispute.final_verdict ?? undefined,
            id: dispute.id,
            isResolved: dispute.status === 'resolved',
            status: dispute.status,
            votes: disputeVotesForAnswer,
          }
          : undefined,
        id: answer.id,
        playerId: answer.room_player_id,
        playerName: playerNames[answer.room_player_id] ?? 'Player',
        points: answer.points,
        verdict: answer.verdict,
        votes: votesByAnswerId[answer.id] ?? [],
      };
    }),
    disputeEndsAt: roundData.dispute_ends_at ?? null,
    expectedVoteCount,
    openDisputeCount,
    pendingDisputeVoterNames,
    isRoundReady,
    pendingSubmitterNames,
    pendingVoterNames,
    scoringEndsAt: roundData.scoring_ends_at ?? null,
    scores,
    submittedPlayerCount,
    voteCount,
  };
}

export async function getOnlineMatchStandings(roomId: string): Promise<OnlineMatchStanding[]> {
  const players = await getRoomPlayersForStandings(roomId);
  const playerNames = getPlayerNameMap(players);

  const { data: roundsData, error: roundsError } = await supabase
    .from('rounds')
    .select('id, round_number')
    .eq('room_id', roomId)
    .order('round_number', { ascending: true });

  if (roundsError) {
    throw new Error(roundsError.message);
  }

  const rounds = (roundsData ?? []) as Array<Pick<RoundRow, 'id' | 'round_number'>>;
  const roundIds = rounds.map((round) => round.id);
  const latestRoundNumber = Math.max(0, ...rounds.map((round) => round.round_number));
  const roundNumberById = Object.fromEntries(rounds.map((round) => [round.id, round.round_number]));
  const { data: scoresData, error: scoresError } = roundIds.length
    ? await supabase
      .from('round_scores')
      .select('answered_count, room_player_id, round_id, score')
      .in('round_id', roundIds)
    : { data: [], error: null };

  if (scoresError) {
    throw new Error(scoresError.message);
  }

  const scores = (scoresData ?? []) as Array<RoundScoreRow & { round_id: string }>;
  const standingsByPlayer = players.reduce<Record<string, OnlineMatchStanding>>((standings, player) => {
    standings[player.id] = {
      lastRoundScore: 0,
      playerId: player.id,
      playerName: playerNames[player.id] ?? 'Player',
      roundsPlayed: 0,
      totalScore: 0,
    };

    return standings;
  }, {});

  for (const score of scores) {
    const standing = standingsByPlayer[score.room_player_id] ?? {
      lastRoundScore: 0,
      playerId: score.room_player_id,
      playerName: playerNames[score.room_player_id] ?? 'Player',
      roundsPlayed: 0,
      totalScore: 0,
    };

    standing.totalScore += score.score;
    standing.roundsPlayed += 1;

    if (roundNumberById[score.round_id] === latestRoundNumber) {
      standing.lastRoundScore = score.score;
    }

    standingsByPlayer[score.room_player_id] = standing;
  }

  return Object.values(standingsByPlayer)
    .sort((a, b) => b.totalScore - a.totalScore || a.playerName.localeCompare(b.playerName));
}

export async function getOnlinePlayerRoundHistory(
  roomId: string,
  playerId: string,
): Promise<OnlinePlayerRoundSummary[]> {
  const { data: roundsData, error: roundsError } = await supabase
    .from('rounds')
    .select('id, letter, round_number')
    .eq('room_id', roomId)
    .order('round_number', { ascending: true });

  if (roundsError) {
    throw new Error(roundsError.message);
  }

  const rounds = (roundsData ?? []) as Array<Pick<RoundRow, 'id' | 'letter' | 'round_number'>>;
  const roundIds = rounds.map((round) => round.id);
  const { data: scoresData, error: scoresError } = roundIds.length
    ? await supabase
      .from('round_scores')
      .select('answered_count, round_id, score')
      .eq('room_player_id', playerId)
      .in('round_id', roundIds)
    : { data: [], error: null };

  if (scoresError) {
    throw new Error(scoresError.message);
  }

  const scoreByRoundId = Object.fromEntries(((scoresData ?? []) as Array<RoundScoreRow & { round_id: string }>)
    .map((score) => [score.round_id, score]));

  return rounds
    .filter((round) => scoreByRoundId[round.id])
    .map((round) => ({
      answeredCount: scoreByRoundId[round.id].answered_count,
      letter: round.letter,
      roundId: round.id,
      roundNumber: round.round_number,
      score: scoreByRoundId[round.id].score,
    }));
}

export async function submitOnlineAnswers({
  answers,
  playerId,
  roomId,
  roundId,
}: {
  answers: AnswersByCategory;
  playerId: string;
  roomId: string;
  roundId: string;
}): Promise<OnlineAnswerSubmitResult> {
  const rows = Object.entries(answers).map(([category, answerText = '']) => {
    const cleanAnswer = answerText.trim();
    const verdict: AnswerVerdict = 'blank';

    return {
      answer_text: cleanAnswer,
      category,
      points: scoreAnswer({ verdict }),
      room_player_id: playerId,
      round_id: roundId,
      verdict,
    };
  });

  const { devicePlayerId, expectedRevision } = await getAuthoritativeRoundContext(roundId);
  const { error: answersError } = await supabase.rpc('submit_answer_command', {
    p_answers: Object.fromEntries(rows.map((row) => [row.category, row.answer_text])),
    p_command_id: createCommandId(),
    p_device_player_id: devicePlayerId,
    p_expected_revision: expectedRevision,
    p_room_id: roomId,
    p_room_player_id: playerId,
  });

  if (answersError) {
    throw new Error(answersError.message);
  }

  const answeredCount = rows.filter((row) => row.answer_text).length;
  const score = rows.reduce((total, row) => total + row.points, 0);

  return {
    answeredCount,
    score,
  };
}

export async function persistOnlineAnswerVerdict({
  answerText: _answerText,
  category: _category,
  playerId: _playerId,
  roundId: _roundId,
  verdict: _verdict,
}: {
  answerText: string;
  category: StarterCategory;
  playerId: string;
  roundId: string;
  verdict: AnswerVerdict;
}) {
  // Online answer verdicts are server-owned. Votes, disputes, and timeout
  // finalisation are the only competitive mutation paths.
  return { answeredCount: 0, score: 0 };
}

const submitVoteFlight = createVoteFlights();

export async function persistOnlineAnswerVote({
  answerOwnerPlayerId,
  category,
  finalVerdict,
  roundId,
  voterPlayerId,
  vote,
}: {
  answerOwnerPlayerId: string;
  category: StarterCategory;
  finalVerdict: OnlineVoteVerdict;
  roundId: string;
  voterPlayerId: string;
  vote: OnlineVoteVerdict;
}) {
  return submitVoteFlight(`category:${roundId}:${answerOwnerPlayerId}:${category}:${voterPlayerId}`, vote, async () => {
    let answerId: string | null;
    try {
      answerId = await getAnswerId(roundId, answerOwnerPlayerId, category);
    } catch (error) { throw voteFailure(error, 'answer-lookup'); }
    if (!answerId) throw new VoteCommandError('Answer not found for vote.', 'answer-lookup', 'rejected');
    return persistOnlineAnswerVoteById({ answerId, answerOwnerPlayerId, finalVerdict, roundId, vote, voterPlayerId });
  });
}

export async function persistOnlineAnswerVoteById({
  answerId,
  roundId,
  voterPlayerId,
  vote,
}: {
  answerId: string;
  answerOwnerPlayerId?: string;
  finalVerdict?: OnlineVoteVerdict;
  roundId: string;
  voterPlayerId: string;
  vote: OnlineVoteVerdict;
}) {
  return submitVoteFlight(`answer:${roundId}:${answerId}:${voterPlayerId}`, vote, async () => {
    let context: Awaited<ReturnType<typeof getAuthoritativeRoundContext>>;
    try { context = await getAuthoritativeRoundContext(roundId, true); }
    catch (error) { throw voteFailure(error, 'context'); }
    const commandId = createCommandId();
    try {
      const response = await supabase.rpc('submit_answer_vote_command', {
        p_answer_id: answerId, p_command_id: commandId,
        p_device_player_id: context.devicePlayerId, p_expected_revision: context.expectedRevision,
        p_room_id: context.roomId, p_room_player_id: voterPlayerId, p_verdict: vote,
      });
      const data = requireVoteResponse(response, 'cast-vote', commandId);
      if (data.answer_id !== answerId || typeof data.revision !== 'number' || typeof data.duplicate !== 'boolean') {
        throw new VoteCommandError('Invalid vote acknowledgement.', 'cast-vote', 'uncertain', response.status, undefined, commandId);
      }
      return { accepted: true, commandId, revision: data.revision, duplicate: data.duplicate,
        resolved: data.resolved === true, finalVerdict: typeof data.final_verdict === 'string' ? data.final_verdict : undefined };
    } catch (error) { throw voteFailure(error, 'cast-vote', true, commandId); }
  });
}

export async function openOnlineAnswerDispute({
  answerId,
  openedByPlayerId,
  roomId,
  roundId,
}: {
  answerId: string;
  openedByPlayerId: string;
  roomId: string;
  roundId: string;
}) {
  const { data, error } = await supabase.rpc('open_answer_dispute_command', {
    p_answer_id: answerId,
    p_device_player_id: await getDevicePlayerId(),
    p_opened_by_player_id: openedByPlayerId,
    p_room_id: roomId,
    p_round_id: roundId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as string;
}

export async function persistOnlineDisputeVote({
  disputeId,
  roundId,
  roomId,
  verdict,
  voterPlayerId,
}: {
  disputeId: string;
  roundId: string;
  roomId: string;
  verdict: OnlineVoteVerdict;
  voterPlayerId: string;
}) {
  return submitVoteFlight(`dispute:${roomId}:${roundId}:${disputeId}:${voterPlayerId}`, verdict, async () => {
    let devicePlayerId: string;
    try { devicePlayerId = await getDevicePlayerId(); }
    catch (error) { throw voteFailure(error, 'identity'); }
    try {
      const response = await supabase.rpc('cast_answer_dispute_vote_command', {
        p_device_player_id: devicePlayerId, p_dispute_id: disputeId, p_round_id: roundId,
        p_room_id: roomId, p_verdict: verdict, p_voter_player_id: voterPlayerId,
      });
      const data = requireVoteResponse(response, 'cast-dispute-vote');
      if (data.dispute_id !== disputeId || data.verdict !== verdict) {
        throw new VoteCommandError('Invalid dispute vote acknowledgement.', 'cast-dispute-vote', 'uncertain', response.status);
      }
    } catch (error) { throw voteFailure(error, 'cast-dispute-vote', true); }

    // Acceptance is durable even if the separate resolution request fails.
    const receipt: VoteReceipt = { accepted: true };
    try {
      const response = await supabase.rpc('resolve_answer_dispute_command', {
        p_device_player_id: devicePlayerId, p_dispute_id: disputeId,
        p_resolver_player_id: voterPlayerId, p_room_id: roomId, p_round_id: roundId,
      });
      const data = requireVoteResponse(response, 'resolve-dispute');
      if (data.dispute_id !== disputeId || typeof data.resolved !== 'boolean') {
        throw new VoteCommandError('Invalid dispute resolution acknowledgement.', 'resolve-dispute', 'uncertain', response.status);
      }
      receipt.resolved = data.resolved;
      receipt.finalVerdict = typeof data.final_verdict === 'string' ? data.final_verdict : undefined;
    } catch (error) { receipt.warning = voteFailure(error, 'resolve-dispute', true); }
    return receipt;
  });
}

export async function finalizeOnlineRoundTimeout({
  playerId,
  roomId,
  roundId,
}: {
  playerId: string;
  roomId: string;
  roundId: string;
}) {
  const { data, error } = await supabase.rpc('finalize_live_brawl_timeout_command', {
    p_command_id: createCommandId(),
    p_device_player_id: await getDevicePlayerId(),
    p_room_id: roomId,
    p_room_player_id: playerId,
    p_round_id: roundId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as {
    accepted: boolean;
    duplicate: boolean;
    phase: 'answering' | 'scoring' | 'dispute' | 'complete';
    revision: number;
    round_id: string;
  };
}

export async function submitOnlineReport({
  answerId,
  details,
  reason,
  reportedPlayerId,
  reporterPlayerId,
  roomId,
}: OnlineReportInput) {
  const cleanReason = reason.trim().slice(0, 80);
  const cleanDetails = details?.trim().slice(0, 500) || null;

  if (!cleanReason) {
    throw new Error('Choose a report reason first.');
  }

  const { error } = await supabase
    .from('reports')
    .insert({
      answer_id: answerId ?? null,
      details: cleanDetails,
      reason: cleanReason,
      reported_player_id: reportedPlayerId ?? null,
      reporter_player_id: reporterPlayerId ?? null,
      room_id: roomId,
    });

  if (error) {
    throw new Error(error.message);
  }
}

export async function completeOnlineRound({
  finishMatch = false,
  playerId,
  roomId,
  roundId,
}: {
  finishMatch?: boolean;
  playerId: string;
  roomId: string;
  roundId: string;
}) {
  const readiness = await getOnlineRevealSnapshot(roomId, roundId);

  if (!readiness.isRoundReady) {
    const pendingNames = [
      ...readiness.pendingSubmitterNames,
      ...readiness.pendingVoterNames,
      ...readiness.pendingDisputeVoterNames,
    ].filter((name, index, names) => names.indexOf(name) === index);

    throw new Error(
      pendingNames.length
        ? `Waiting for ${pendingNames.join(', ')}.`
        : 'Round is not ready to finish yet.',
    );
  }

  const { devicePlayerId, expectedRevision } = await getAuthoritativeRoomContext(roomId);
  const { error } = await supabase.rpc('complete_online_round_command', {
    p_capability: await getRoomCapability(playerId),
    p_command_id: createCommandId(),
    p_device_player_id: devicePlayerId,
    p_expected_revision: expectedRevision,
    p_finish_match: finishMatch,
    p_room_id: roomId,
    p_room_player_id: playerId,
    p_round_id: roundId,
  });

  if (error) {
    throw new Error(error.message);
  }
}

async function insertRoomPlayer(roomId: string, devicePlayerId: string, displayName: string) {
  const { data, error } = await supabase
    .from('room_players')
    .insert({
      device_player_id: devicePlayerId,
      display_name: displayName,
      role: 'player',
      room_id: roomId,
    })
    .select('id')
    .single<{ id: string }>();

  if (error) {
    throw new Error(error.message);
  }

  return data.id;
}

const ROOM_CAPABILITIES_KEY = 'word-brawl:room-capabilities';
type ManagedRoomResult = { roomId: string; playerId: string; capability: string };
async function getRoomCapabilities(): Promise<Record<string, string>> {
  return JSON.parse(await AsyncStorage.getItem(ROOM_CAPABILITIES_KEY) ?? '{}');
}
async function getRoomCapability(playerId: string) {
  const capability = (await getRoomCapabilities())[playerId];
  if (!capability) throw new Error('This older room has no management credential. Create a new room.');
  return capability;
}
async function finishManagedRoom(result: ManagedRoomResult, name: string) {
  await AsyncStorage.mergeItem(ROOM_CAPABILITIES_KEY, JSON.stringify({ [result.playerId]: result.capability }));
  const { data, error } = await supabase.from('rooms').select(ROOM_SELECT_FIELDS).eq('id', result.roomId).single<RoomRow>();
  if (error) throw new Error(error.message);
  return buildOnlineRoomResult(data, result.playerId, name);
}
export type OnlineBotRound = {
  playerId: string;
  playerName: string;
  personality: string;
  answers: Array<{ category: StarterCategory; answer: string; verdict: AnswerVerdict; points: number }>;
  answeredCount: number;
  score: number;
  totalScore: number;
};
export async function getOnlineBotRoster(roomId: string): Promise<Array<{playerId: string; playerName: string; personality: string}>> {
  const { data, error } = await supabase.rpc('get_online_bot_roster', { p_room_id: roomId });
  if (error) throw new Error(error.message);
  return data;
}
export type OnlineBotRoundSnapshot = { roomId: string; roundId: string; bots: OnlineBotRound[] };
export async function getOnlineBotRoundSnapshot(roomId: string, roundId: string): Promise<OnlineBotRoundSnapshot> {
  const { data, error } = await supabase.rpc('get_online_bot_round_snapshot', { p_room_id: roomId, p_round_id: roundId });
  if (error) throw new Error(error.message);
  return data as OnlineBotRoundSnapshot;
}

// Coalesce double-taps from this device; server serializes different clients.
let publicRoomJoinInFlight: Promise<OnlineRoomResult> | null = null;
export function findOrCreatePublicRoom(
  displayName: string, settings: OnlineRoomSettings,
  options: { matchmakingBucket: string; maxPlayers?: number; minClientVersion: string; rulesetVersion: number },
): Promise<OnlineRoomResult> {
  if (!publicRoomJoinInFlight) {
    publicRoomJoinInFlight = findOrCreatePublicRoomCommand(displayName, settings, options)
      .finally(() => { publicRoomJoinInFlight = null; });
  }
  return publicRoomJoinInFlight;
}
