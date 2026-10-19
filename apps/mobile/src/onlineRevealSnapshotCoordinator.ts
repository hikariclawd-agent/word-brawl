export type OnlineRevealSnapshotRequestKind = 'poll' | 'authoritative';

export type OnlineRevealSnapshotRequest = {
  id: number;
  key: string;
  kind: OnlineRevealSnapshotRequestKind;
  mutationEpoch: number;
};

type OnlineRevealSnapshotRequestState = {
  authoritativeRequestId: number | null;
  key: string | null;
  latestId: number;
  mutationEpoch: number;
  mutationPending: boolean;
  nextId: number;
};

export function createOnlineRevealSnapshotCoordinator() {
  const state: OnlineRevealSnapshotRequestState = {
    authoritativeRequestId: null,
    key: null,
    latestId: 0,
    mutationEpoch: 0,
    mutationPending: false,
    nextId: 0,
  };

  function resetForKey(key: string | null) {
    state.key = key;
    state.latestId = 0;
    state.mutationEpoch += 1;
    state.mutationPending = false;
    state.authoritativeRequestId = null;
  }

  function ensureKey(key: string | null) {
    if (state.key !== key) {
      resetForKey(key);
    }
  }

  function invalidate() {
    state.latestId = 0;
    state.mutationEpoch += 1;
    state.mutationPending = false;
    state.authoritativeRequestId = null;
  }

  function beginMutation() {
    state.latestId = 0;
    state.mutationEpoch += 1;
    state.mutationPending = true;
    state.authoritativeRequestId = null;
    return state.mutationEpoch;
  }

  function finishMutation(mutationEpoch: number) {
    if (state.mutationEpoch !== mutationEpoch) return;
    state.latestId = 0;
    state.mutationPending = false;
    state.authoritativeRequestId = null;
  }

  function beginRequest(key: string, kind: OnlineRevealSnapshotRequestKind = 'poll'): OnlineRevealSnapshotRequest {
    ensureKey(key);

    const request: OnlineRevealSnapshotRequest = {
      id: ++state.nextId,
      key,
      kind,
      mutationEpoch: state.mutationEpoch,
    };

    if (kind === 'authoritative') {
      state.authoritativeRequestId = request.id;
      state.latestId = request.id;
    } else if (!state.mutationPending && state.authoritativeRequestId === null) {
      state.latestId = request.id;
    }

    return request;
  }

  function isCurrent(request: OnlineRevealSnapshotRequest) {
    if (
      state.key !== request.key
      || state.mutationEpoch !== request.mutationEpoch
      || state.latestId !== request.id
    ) {
      return false;
    }

    return request.kind === 'authoritative'
      ? state.mutationPending && state.authoritativeRequestId === request.id
      : !state.mutationPending && state.authoritativeRequestId === null;
  }

  return { beginMutation, beginRequest, ensureKey, finishMutation, invalidate, isCurrent };
}
