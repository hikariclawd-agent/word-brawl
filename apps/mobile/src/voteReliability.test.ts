import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withVoteAcknowledgement } from './voteCommands';

const transport = vi.hoisted(() => ({ rpc: vi.fn(), read: vi.fn() }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn().mockResolvedValue('device') } }));
vi.mock('./supabase', () => ({ supabase: {
  rpc: transport.rpc,
  from(table: string) {
    const chain = { select: () => chain, eq: () => chain,
      single: () => transport.read(table), maybeSingle: () => transport.read(table) };
    return chain;
  },
} }));
let service: typeof import('./onlineRooms');
const vote = { answerId: 'answer', roundId: 'round', voterPlayerId: 'voter', vote: 'valid' as const };
const dispute = { disputeId: 'dispute', roomId: 'room', roundId: 'round', voterPlayerId: 'owner', verdict: 'variant' as const };
const ok = (data: unknown) => ({ data, error: null, status: 200 });
const accepted = () => ok({ accepted: true, answer_id: 'answer', revision: 8, duplicate: false, resolved: true, final_verdict: 'valid' });
const rejected = (status: number, code?: string) => ({ data: null, status,
  error: { message: 'Rejected by server', code, details: 'diagnostic detail', hint: 'diagnostic hint' } });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  service = await import('./onlineRooms');
  transport.read.mockImplementation(async (table) => ok(table === 'rounds' ? { room_id: 'room' }
    : table === 'rooms' ? { match_revision: 7 } : { id: 'answer' }));
  transport.rpc.mockResolvedValue(accepted());
});

describe('real onlineRooms vote commands', () => {
  it('only permits confirmed UI feedback after an accepted RPC response', async () => {
    const pending = deferred<ReturnType<typeof accepted>>();
    transport.rpc.mockReturnValue(pending.promise);
    const confirmed = vi.fn();
    const action = withVoteAcknowledgement(() => service.persistOnlineAnswerVoteById(vote), confirmed);
    await tick(); expect(confirmed).not.toHaveBeenCalled();
    pending.resolve(accepted()); await action;
    expect(confirmed).toHaveBeenCalledOnce();
    expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({ accepted: true, revision: 8 }));
    expect(transport.rpc).toHaveBeenCalledWith('submit_answer_vote_command', expect.objectContaining({
      p_expected_revision: 7, p_device_player_id: 'device', p_room_player_id: 'voter', p_command_id: expect.any(String),
    }));
  });
  it('retains the self-vote rejection and never confirms success', async () => {
    transport.rpc.mockResolvedValue({ ...rejected(401, '42501'), error: {
      message: 'Players cannot vote on their own answer.', code: '42501', details: '', hint: '',
    } });
    const confirmed = vi.fn();
    await expect(withVoteAcknowledgement(() => service.persistOnlineAnswerVote({
      answerOwnerPlayerId: 'owner', category: 'Name', finalVerdict: 'valid', roundId: 'round', vote: 'valid', voterPlayerId: 'owner',
    }), confirmed)).rejects.toMatchObject({ outcome: 'rejected', status: 401, code: '42501', stage: 'cast-vote' });
    expect(confirmed).not.toHaveBeenCalled();
    expect(transport.rpc.mock.calls[0][1].p_room_player_id).toBe('owner');
  });
  it.each([[401, undefined], [401, '42501'], [403, '42501'], [400, '22023']])(
    'preserves HTTP %s and server code %s independently', async (status, code) => {
      transport.rpc.mockResolvedValue(rejected(status as number, code as string | undefined));
      await expect(service.persistOnlineAnswerVoteById(vote)).rejects.toMatchObject({
        status, code, details: 'diagnostic detail', hint: 'diagnostic hint', outcome: 'rejected', commandId: expect.any(String),
      });
    },
  );
  it('preserves structured preflight failures without dispatching a command', async () => {
    transport.read.mockResolvedValue(rejected(401, 'PGRST301'));
    await expect(service.persistOnlineAnswerVoteById(vote)).rejects.toMatchObject({ status: 401, code: 'PGRST301', stage: 'round-context' });
    expect(transport.rpc).not.toHaveBeenCalled();
  });
  it.each(['response', 'throw'])('keeps a network %s uncertain and never retries it', async (mode) => {
    if (mode === 'response') transport.rpc.mockResolvedValue(rejected(0));
    else transport.rpc.mockRejectedValue(new TypeError('Failed to fetch'));
    const confirmed = vi.fn();
    await expect(withVoteAcknowledgement(() => service.persistOnlineAnswerVoteById(vote), confirmed)).rejects.toMatchObject({ outcome: 'uncertain' });
    await expect(service.persistOnlineAnswerVoteById(vote)).rejects.toMatchObject({ outcome: 'uncertain' });
    await expect(service.persistOnlineAnswerVoteById({ ...vote, vote: 'invalid' })).rejects.toMatchObject({ outcome: 'rejected', stage: 'submission' });
    expect(transport.rpc).toHaveBeenCalledOnce(); expect(confirmed).not.toHaveBeenCalled();
  });
  it('coalesces identical delayed votes and rejects conflicting clicks', async () => {
    const pending = deferred<ReturnType<typeof accepted>>(); transport.rpc.mockReturnValue(pending.promise);
    const first = service.persistOnlineAnswerVoteById(vote);
    const second = service.persistOnlineAnswerVoteById(vote);
    await expect(service.persistOnlineAnswerVoteById({ ...vote, vote: 'invalid' })).rejects.toMatchObject({ stage: 'submission' });
    await tick(); expect(transport.rpc).toHaveBeenCalledOnce();
    pending.resolve(accepted());
    expect(await first).toEqual(await second);
  });
  it.each([null, { accepted: false }, { accepted: true }, { accepted: true, answer_id: 'wrong', revision: 8, duplicate: false }])(
    'does not confirm malformed acknowledgement %j', async (data) => {
      transport.rpc.mockResolvedValue(ok(data));
      await expect(service.persistOnlineAnswerVoteById(vote)).rejects.toMatchObject({ outcome: 'uncertain' });
    },
  );
  it('allows legitimate own-answer dispute votes and does not treat pending resolution as failure', async () => {
    transport.rpc.mockResolvedValueOnce(ok({ accepted: true, dispute_id: 'dispute', verdict: 'variant' }))
      .mockResolvedValueOnce(ok({ accepted: true, dispute_id: 'dispute', resolved: false }));
    expect(await service.persistOnlineDisputeVote(dispute)).toMatchObject({ accepted: true, resolved: false });
    expect(transport.rpc.mock.calls.map(([name]) => name)).toEqual(['cast_answer_dispute_vote_command', 'resolve_answer_dispute_command']);
    expect(transport.rpc.mock.calls[0][1].p_voter_player_id).toBe('owner');
  });
  it('preserves acceptance when resolution fails and does not resend the accepted vote', async () => {
    transport.rpc.mockResolvedValueOnce(ok({ accepted: true, dispute_id: 'dispute', verdict: 'variant' }))
      .mockResolvedValueOnce(rejected(401, '42501'));
    const receipt = await service.persistOnlineDisputeVote(dispute);
    expect(receipt).toMatchObject({ accepted: true, warning: { stage: 'resolve-dispute', status: 401, code: '42501' } });
    expect(await service.persistOnlineDisputeVote(dispute)).toEqual(receipt);
    expect(transport.rpc).toHaveBeenCalledTimes(2);
  });
  it('coalesces delayed dispute votes including resolution and blocks conflicting verdicts', async () => {
    const pending = deferred<ReturnType<typeof ok>>();
    transport.rpc.mockReturnValueOnce(pending.promise).mockResolvedValue(ok({ accepted: true, dispute_id: 'dispute', resolved: true, final_verdict: 'variant' }));
    const first = service.persistOnlineDisputeVote(dispute); const second = service.persistOnlineDisputeVote(dispute);
    await expect(service.persistOnlineDisputeVote({ ...dispute, verdict: 'invalid' })).rejects.toMatchObject({ stage: 'submission' });
    pending.resolve(ok({ accepted: true, dispute_id: 'dispute', verdict: 'variant' }));
    expect(await first).toEqual(await second); expect(transport.rpc).toHaveBeenCalledTimes(2);
  });
  it('never resolves or retries an uncertain dispute cast', async () => {
    transport.rpc.mockResolvedValue(rejected(0));
    await expect(service.persistOnlineDisputeVote(dispute)).rejects.toMatchObject({ outcome: 'uncertain' });
    await expect(service.persistOnlineDisputeVote(dispute)).rejects.toMatchObject({ outcome: 'uncertain' });
    expect(transport.rpc).toHaveBeenCalledOnce();
  });
});
