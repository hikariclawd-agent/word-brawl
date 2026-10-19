import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  reads: new Map<string, unknown[]>(),
  rpc: vi.fn(),
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(
      key.includes('capabilities') ? JSON.stringify({ 'player-1': 'capability-1' }) : 'device-1',
    )),
  },
}));

vi.mock('./supabase', () => ({
  supabase: {
    rpc: transport.rpc,
    from(table: string) {
      const next = () => {
        const values = transport.reads.get(table) ?? [];
        return values.shift() ?? { data: null, error: null };
      };
      const chain = {
        select: () => chain,
        update: () => chain,
        eq: () => chain,
        not: () => chain,
        gt: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => chain,
        maybeSingle: () => Promise.resolve(next()),
        single: () => Promise.resolve(next()),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(next()).then(resolve),
      };
      return chain;
    },
  },
}));

let service: typeof import('./onlineRooms');

const ok = (data: unknown) => ({ data, error: null });
const fail = (message: string) => ({ data: null, error: { message } });
const room = (visibility: 'private' | 'public' = 'private') => ({
  id: 'room-1', code: 'ABC123', expires_at: '2099-01-01T00:00:00.000Z', status: 'lobby',
  room_visibility: visibility, started_at: null, categories: ['Name'], target_rounds: 3,
});
const candidate = {
  id: 'player-1', room_id: 'room-1', display_name: 'Player', is_host: true,
  joined_at: '2026-01-01T00:00:00.000Z', role: 'player', status: 'disconnected',
  left_at: new Date(Date.now() - 1_000).toISOString(),
};
const activeCandidate = { ...candidate, status: 'active' as const, left_at: null };
const activeRound = { id: 'round-1', letter: 'A', round_number: 1, status: 'active', ends_at: null, started_by_player_id: null };

function queue(table: string, ...values: unknown[]) {
  transport.reads.set(table, values);
}

function queueResumableRoom(visibility: 'private' | 'public') {
  queue('room_players', ok([candidate]), ok([candidate]));
  queue('rooms', ok(room(visibility)));
  queue('rounds', ok(activeRound));
  queue('answers', ok([]));
  transport.rpc.mockResolvedValue({ data: { roomId: 'room-1', playerId: 'player-1', capability: 'capability-1' }, error: null });
}

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  transport.reads.clear();
  service = await import('./onlineRooms');
});

describe('online room resume safety', () => {
  it.each([
    ['terminal', { data: null, error: null }],
    ['expired', { data: null, error: null }],
  ])('does not reactivate a %s foreground room', async (_label, roomResult) => {
    queue('rooms', roomResult);

    await expect(service.recoverOnlineRoomPlayer({ roomId: 'room-1', playerId: 'player-1', displayName: 'Player' }))
      .resolves.toMatchObject({ status: 'unavailable' });
    expect(transport.rpc).not.toHaveBeenCalled();
  });

  it('uses the guarded rejoin RPC for valid foreground recovery', async () => {
    queue('rooms', ok(room()));
    transport.rpc.mockResolvedValue({ data: { roomId: 'room-1', playerId: 'player-1' }, error: null });

    await expect(service.recoverOnlineRoomPlayer({ roomId: 'room-1', playerId: 'player-1', displayName: 'Player' }))
      .resolves.toEqual({ status: 'active' });
    expect(transport.rpc).toHaveBeenCalledWith('join_managed_room', expect.objectContaining({
      p_code: 'ABC123', p_device_player_id: 'device-1', p_capabilities: { 'player-1': 'capability-1' },
    }));
  });

  it('preserves genuine foreground network or authentication failures', async () => {
    queue('rooms', fail('network unavailable'));

    await expect(service.recoverOnlineRoomPlayer({ roomId: 'room-1', playerId: 'player-1' }))
      .rejects.toThrow('network unavailable');
  });

  it('classifies a guarded foreground reconnect rejection as unavailable', async () => {
    queue('rooms', ok(room()));
    transport.rpc.mockResolvedValue({ data: null, error: { message: 'Reconnect window expired' } });

    await expect(service.recoverOnlineRoomPlayer({ roomId: 'room-1', playerId: 'player-1' }))
      .resolves.toMatchObject({ status: 'unavailable', reason: 'Reconnect window expired' });
  });

  it('does not reactivate a seat when the room is terminal or missing', async () => {
    queue('room_players', ok([candidate]));
    queue('rooms', ok(null));

    expect(await service.resumeOnlineRoom()).toBeNull();
    expect(transport.rpc).not.toHaveBeenCalled();
  });

  it('skips an older candidate and resumes a later valid room', async () => {
    const olderCandidate = { ...candidate, id: 'older-player', room_id: 'older-room' };
    const validCandidate = { ...candidate, id: 'player-1', room_id: 'room-1' };
    queue('room_players', ok([olderCandidate, validCandidate]), ok([olderCandidate]), ok([validCandidate]));
    queue('rooms', ok({ ...room(), id: 'older-room', code: 'OLD123' }), ok(room()));
    queue('rounds', ok(null), ok(null));
    queue('answers', ok([]));
    transport.rpc.mockResolvedValue({ data: { roomId: 'room-1', playerId: 'player-1', capability: 'capability-1' }, error: null });

    const result = await service.resumeOnlineRoom();

    expect(result).toMatchObject({ id: 'room-1', playerId: 'player-1' });
    expect(transport.rpc).toHaveBeenCalledOnce();
  });

  it('returns no room when the only candidate is an older room', async () => {
    const olderCandidate = { ...candidate, id: 'older-player', room_id: 'older-room' };
    queue('room_players', ok([olderCandidate]), ok([olderCandidate]));
    queue('rooms', ok({ ...room(), id: 'older-room', code: 'OLD123' }));
    queue('rounds', ok(null));

    await expect(service.resumeOnlineRoom()).resolves.toBeNull();
    expect(transport.rpc).not.toHaveBeenCalled();
  });

  it('does not reactivate a seat when answer hydration fails', async () => {
    queue('room_players', ok([candidate]), ok([candidate]));
    queue('rooms', ok(room()));
    queue('rounds', ok(activeRound));
    queue('answers', fail('answers unavailable'));

    await expect(service.resumeOnlineRoom()).rejects.toThrow('answers unavailable');
    expect(transport.rpc).not.toHaveBeenCalled();
  });

  it.each(['private', 'public'] as const)('uses the guarded rejoin RPC for %s rooms', async (visibility) => {
    queueResumableRoom(visibility);

    const result = await service.resumeOnlineRoom();

    expect(result).toMatchObject({
      id: 'room-1', playerId: 'player-1',
      activeRound: { id: 'round-1', letter: 'A', roundNumber: 1, status: 'active' },
    });
    expect(transport.rpc).toHaveBeenCalledWith('join_managed_room', expect.objectContaining({
      p_code: 'ABC123', p_device_player_id: 'device-1', p_capabilities: { 'player-1': 'capability-1' },
    }));
  });

  it('skips a concurrent seat-state rejection from the guarded rejoin', async () => {
    queueResumableRoom('private');
    transport.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Reconnect window expired' } });

    await expect(service.resumeOnlineRoom()).resolves.toBeNull();
  });

  it('does not restore an active seat after it becomes disconnected during hydration', async () => {
    queue('room_players', ok([activeCandidate]), ok([activeCandidate]), { data: null, error: null });
    queue('rooms', ok(room()));
    queue('rounds', ok(activeRound));
    queue('answers', ok([]));

    await expect(service.resumeOnlineRoom()).resolves.toBeNull();
    expect(transport.rpc).not.toHaveBeenCalled();
  });

  it('coalesces concurrent duplicate resume calls into one reactivation', async () => {
    queueResumableRoom('private');

    const first = service.resumeOnlineRoom();
    const second = service.resumeOnlineRoom();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toEqual(secondResult);
    expect(transport.rpc).toHaveBeenCalledOnce();
  });
});
