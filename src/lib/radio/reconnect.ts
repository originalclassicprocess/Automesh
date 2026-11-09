import { networkId, networkInvite } from './network';
import type { RadioAccountState } from './account-state';
import type { RadioSnapshot, SerialPortLike } from './serial-radio';
export function preferredConnection(state:RadioAccountState){return state.connection??state.boards?.find(b=>b.node===state.defaultNode);}

// Never guess among indistinguishable granted ports or replace the remembered
// network key by opening channel 0 before restoring the chosen channel.
export function rememberedPort(ports: SerialPortLike[], previous?: SerialPortLike): SerialPortLike {
  if (previous && ports.includes(previous)) return previous;
  if (ports.length === 1) return ports[0];
  throw Error(ports.length ? 'radio_port_ambiguous' : 'radio_port_missing');
}
export async function rememberedChannel(snapshot: RadioSnapshot, state: RadioAccountState, automatic: boolean): Promise<number> {
  const remembered = state.connection ?? (state.own ? {node:state.own.contact.body.node,network:state.own.contact.body.network} : undefined);
  if (remembered && snapshot.node === remembered.node) {
    for (const channel of snapshot.channels) if (await networkId(networkInvite(snapshot.profile,channel)) === remembered.network) return channel.index;
    throw Error('radio_channel_changed');
  }
  if (automatic && remembered) throw Error('radio_wrong_board');
  if (!snapshot.channels.length) throw Error('radio_incomplete_config');
  return snapshot.channels[0].index;
}
