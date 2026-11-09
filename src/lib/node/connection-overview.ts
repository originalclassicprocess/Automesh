export type ConnectionOverview = {
  signaling: 'connected' | 'waiting' | 'disabled'; direct: number;
  queue: 'connected' | 'waiting' | 'disabled' | 'unselected';
  receiver: 'connected' | 'waiting' | 'unselected'; pending: number;
  rights: 'node' | 'direct' | 'primary' | 'unavailable'; paused: boolean;
};
export function connectionOverview(input: { signalingEnabled: boolean; signalingConnected: boolean; direct: number;
  queueSelected: boolean; queueEnabled: boolean; queueConnected: boolean; pending: number; receiveExpected: boolean; receiveConnected: boolean;
  rights: 'node' | 'direct' | 'primary' | 'unavailable' }): ConnectionOverview {
  return { signaling: !input.signalingEnabled ? 'disabled' : input.signalingConnected ? 'connected' : 'waiting',
    direct: input.direct, queue: !input.queueSelected ? 'unselected' : input.queueConnected ? 'connected' : input.queueEnabled ? 'waiting' : 'disabled',
    receiver: input.receiveConnected ? 'connected' : input.receiveExpected ? 'waiting' : 'unselected',
    pending: input.pending, rights: input.rights, paused: !input.signalingEnabled };
}
