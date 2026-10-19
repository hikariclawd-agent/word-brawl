/** Vote transport state only; never infer a server rejection from a lost response. */
export class VoteCommandError extends Error {
  readonly code?: string;
  readonly details?: string;
  readonly hint?: string;
  constructor(
    message: string,
    readonly stage: string,
    readonly outcome: 'rejected' | 'uncertain',
    readonly status?: number,
    source?: { code?: string; details?: string; hint?: string },
    readonly commandId?: string,
  ) {
    super(message);
    this.name = 'VoteCommandError';
    this.code = source?.code;
    this.details = source?.details;
    this.hint = source?.hint;
  }
}

type Response = {
  data: unknown;
  error: { message: string; code?: string; details?: string; hint?: string } | null;
  status?: number;
};
export function voteFailure(error: unknown, stage: string, dispatched = false, commandId?: string): VoteCommandError {
  if (error instanceof VoteCommandError) return error;
  return new VoteCommandError(error instanceof Error ? error.message : 'Vote request failed.', stage,
    dispatched ? 'uncertain' : 'rejected', undefined, undefined, commandId);
}
export function requireVoteResponse(response: Response, stage: string, commandId?: string) {
  if (response.error) {
    throw new VoteCommandError(response.error.message, stage,
      !response.status || response.status >= 500 ? 'uncertain' : 'rejected',
      response.status, response.error, commandId);
  }
  const data = response.data;
  if (!data || typeof data !== 'object' || !('accepted' in data) || data.accepted !== true) {
    throw new VoteCommandError('Server did not confirm the vote.', stage, 'uncertain', response.status, undefined, commandId);
  }
  return data as Record<string, unknown> & { accepted: true };
}
export function describeVoteFailure(error: VoteCommandError) {
  const codes = [error.status ? `HTTP ${error.status}` : null, error.code].filter(Boolean).join(', ');
  return `${error.outcome === 'uncertain' ? 'Vote outcome unconfirmed. Do not resubmit until checked.' : 'Vote not accepted.'} ${error.message}${codes ? ` (${codes})` : ''}`;
}

export type VoteReceipt = {
  accepted: true;
  resolved?: boolean;
  revision?: number;
  duplicate?: boolean;
  finalVerdict?: string;
  commandId?: string;
  warning?: VoteCommandError;
  refreshWarning?: VoteCommandError;
};
export type VoteOutcome = VoteReceipt | { accepted: false; error: VoteCommandError };

/** One action per target/voter. Uncertain writes stay latched: no blind retries. */
export function createVoteFlights() {
  const flights = new Map<string, { vote: string; promise: Promise<VoteReceipt> }>();
  return (key: string, vote: string, work: () => Promise<VoteReceipt>): Promise<VoteReceipt> => {
    const existing = flights.get(key);
    if (existing) {
      if (existing.vote === vote) return existing.promise;
      return Promise.reject(new VoteCommandError('Another vote for this answer is pending or awaiting confirmation.',
        'submission', 'rejected'));
    }
    const promise = Promise.resolve().then(work).catch((error: unknown) => {
      throw voteFailure(error, 'submission', true);
    });
    flights.set(key, { vote, promise });
    void promise.then((receipt) => {
      if (!receipt.warning && !receipt.refreshWarning) flights.delete(key);
    }, (error: VoteCommandError) => {
      if (error.outcome !== 'uncertain') flights.delete(key);
    });
    return promise;
  };
}

/** Only accepted commands may drive confirmed UI feedback. */
export async function withVoteAcknowledgement(
  action: () => Promise<VoteOutcome>,
  onAccepted: (receipt: VoteReceipt) => void,
): Promise<VoteOutcome> {
  const result = await action();
  if (result.accepted) onAccepted(result);
  return result;
}
