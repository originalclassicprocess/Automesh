export type ExitMode = 'lock' | 'logout';
export type HistoryAction = 'keep-in-memory' | 'save' | 'delete';

export function defaultDeleteHistory(mode: ExitMode, trusted: boolean): boolean {
  return mode === 'logout' && !trusted;
}

export function historyAction(mode: ExitMode, trusted: boolean, deleteHistory: boolean): HistoryAction {
  if (mode === 'lock') return trusted ? 'save' : 'keep-in-memory';
  return deleteHistory ? 'delete' : 'save';
}
