export type SavedDataRefreshState = Readonly<{
  generation: number;
  changeGeneration: number;
  loading: boolean;
  loaded: boolean;
  stale: boolean;
}>;

export type SavedDataRefreshOutcome = 'superseded' | 'failed' | 'fresh' | 'changed-during-read';

export const initialSavedDataRefreshState: SavedDataRefreshState = {
  generation: 0, changeGeneration: 0, loading: false, loaded: false, stale: false,
};

export function beginSavedDataRefresh(state: SavedDataRefreshState) {
  const generation = state.generation + 1;
  return {
    generation,
    changeGenerationAtStart: state.changeGeneration,
    state: { ...state, generation, loading: true },
  };
}

export function finishSavedDataRefresh(
  state: SavedDataRefreshState,
  generation: number,
  changeGenerationAtStart: number,
  succeeded: boolean,
): Readonly<{ state: SavedDataRefreshState; outcome: SavedDataRefreshOutcome }> {
  if (generation !== state.generation) return { state, outcome: 'superseded' };
  if (!succeeded) return { state: { ...state, loading: false, stale: true }, outcome: 'failed' };
  const changed = state.changeGeneration !== changeGenerationAtStart;
  return {
    state: { ...state, loading: false, loaded: true, stale: changed },
    outcome: changed ? 'changed-during-read' : 'fresh',
  };
}

export function noteSavedDataChanged(state: SavedDataRefreshState): SavedDataRefreshState {
  return { ...state, changeGeneration: state.changeGeneration + 1, stale: true };
}

export function setSavedDataBusy(state: SavedDataRefreshState, loading: boolean): SavedDataRefreshState {
  return { ...state, loading };
}

export function isSavedDataDeletionAllowed(state: SavedDataRefreshState): boolean {
  return state.loaded && !state.loading && !state.stale;
}
