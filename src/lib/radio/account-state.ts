import { isValidAccountId } from '$lib/addressing/bech32m';
import { MESSAGE_ID } from '$lib/chat/message-details';
import type { SavedRadioKey } from './crypto';
import type { RadioDelivery } from './conversation';
import { RADIO_PENDING_LIMIT } from './limits';
export type RadioQueueEntry = { peer: string; id: string; text: string; timestamp: number; packet: string; keyId: string; peerKeyId: string };
export type RadioConnection = { node: number; network: string; channel: number; transport?:'bluetooth'; deviceId?:string };
export type RadioBoard = RadioConnection & {name:string;customName?:boolean;firmware:string;lastSeen:number};
export type RadioAccountState = { automatic: boolean; reconnect?: boolean; connection?: RadioConnection; boards?:RadioBoard[]; defaultNode?:number; keys?:SavedRadioKey[]; preferredPeers?: string[]; own?: SavedRadioKey; routes: Record<string, string>; pending: RadioQueueEntry[] };
export const emptyRadioState = (): RadioAccountState => ({ automatic: false, routes: {}, pending: [] });
export const radioDeliveries: RadioDelivery[] = ['queued','transmitting','awaiting','board','received','retry','stopped'];
// Structural bounds here; signatures and private/public key pairing are checked
// asynchronously before any saved material is used by a live USB connection.
export function normalizeRadioState(value: unknown): RadioAccountState {
  const result = emptyRadioState();
  if (!value || typeof value !== 'object') return result;
  const raw = value as Partial<RadioAccountState>;
  result.automatic = raw.automatic === true;
  result.reconnect = raw.reconnect === true;
  if (Array.isArray(raw.preferredPeers)) result.preferredPeers = [...new Set(raw.preferredPeers.filter(isValidAccountId))].slice(0,16);
  const c = raw.connection;
  if (c && Number.isInteger(c.node) && c.node > 0 && c.node < 0xffffffff && /^[a-f0-9]{64}$/.test(c.network) && Number.isInteger(c.channel) && c.channel >= 0 && c.channel <= 7) result.connection = {node:c.node,network:c.network,channel:c.channel,...connectionTransport(c)};
  if (raw.own?.contact?.body && typeof raw.own.privateKey === 'string' && /^[a-f0-9]{64}$/.test(raw.own.privateKey) && JSON.stringify(raw.own).length <= 3000) result.own = JSON.parse(JSON.stringify(raw.own));
  if(Array.isArray(raw.keys))result.keys=raw.keys.slice(0,32).filter(k=>k?.contact?.body&&typeof k.privateKey==='string'&&/^[a-f0-9]{64}$/.test(k.privateKey)&&JSON.stringify(k).length<=3000).map(k=>JSON.parse(JSON.stringify(k)));
  if(Array.isArray(raw.boards))result.boards=raw.boards.slice(0,16).filter((b,i,a)=>b&&Number.isInteger(b.node)&&b.node>0&&b.node<0xffffffff&&a.findIndex(v=>v?.node===b.node)===i&&/^[a-f0-9]{64}$/.test(b.network)&&Number.isInteger(b.channel)&&b.channel>=0&&b.channel<=7&&typeof b.name==='string'&&b.name.length<=32&&!/[\u0000-\u001f\u007f]/.test(b.name)&&typeof b.firmware==='string'&&b.firmware.length<=64&&Number.isSafeInteger(b.lastSeen)&&b.lastSeen>=0).map(b=>({node:b.node,network:b.network,channel:b.channel,name:b.name,firmware:b.firmware,lastSeen:b.lastSeen,...(typeof b.customName==='boolean'?{customName:b.customName}:{}),...connectionTransport(b)}));
  if(result.boards?.length)result.defaultNode=result.boards.some(b=>b.node===raw.defaultNode)?raw.defaultNode:result.boards[0].node;
  if (raw.routes && typeof raw.routes === 'object') for (const [peer, text] of Object.entries(raw.routes).slice(0, 16)) {
    if (isValidAccountId(peer) && typeof text === 'string' && text.startsWith('mesh-radio-contact1:') && text.length <= 2400) result.routes[peer] = text;
  }
  const ids = new Set<string>();
  if (Array.isArray(raw.pending)) for (const entry of raw.pending.slice(0, RADIO_PENDING_LIMIT)) {
    if (!entry || !isValidAccountId(entry.peer) || !MESSAGE_ID.test(entry.id) || ids.has(`${entry.peer}:${entry.id}`) ||
      typeof entry.text !== 'string' || new TextEncoder().encode(entry.text).length > 320 ||
      !Number.isSafeInteger(entry.timestamp) || entry.timestamp < 0 || !/^[a-f0-9]{32}$/.test(entry.keyId) || !/^[a-f0-9]{32}$/.test(entry.peerKeyId) ||
      typeof entry.packet !== 'string' || !/^[a-f0-9]{236,1024}$/.test(entry.packet) || entry.packet.length % 2) continue;
    ids.add(`${entry.peer}:${entry.id}`); result.pending.push({ ...entry });
  }
  return result;
}
export function rememberBoard(state:RadioAccountState,board:RadioBoard):RadioAccountState{
  const boards=state.boards??[],prior=boards.find(b=>b.node===board.node);
  if(!prior&&boards.length>=16)throw Error('radio_board_limit');
  // Keep an explicit user label, but refresh names originally supplied by the
  // board. Old non-generic names predate customName and remain user labels.
  const custom=prior&&(prior.customName===true||prior.customName===undefined&&prior.name!==`Meshtastic !${board.node.toString(16).padStart(8,'0')}`);
  return {...state,boards:prior?boards.map(b=>b.node===board.node?{...board,customName:!!custom,...(custom?{name:b.name}:{})}:b):[...boards,{...board,customName:board.customName??board.name!==`Meshtastic !${board.node.toString(16).padStart(8,'0')}`}],defaultNode:state.defaultNode??board.node};
}
export function forgetBoard(state:RadioAccountState,node:number):RadioAccountState{
  const boards=(state.boards??[]).filter(b=>b.node!==node);
  // Keep encrypted receive keys for pending messages; forgetting is not revocation.
  return {...state,boards,defaultNode:state.defaultNode===node?boards[0]?.node:state.defaultNode,
    ...(state.connection?.node===node?{connection:undefined,reconnect:false}:{})};
}

function connectionTransport(value:Partial<RadioConnection>):Pick<RadioConnection,'transport'|'deviceId'>{
  return value.transport==='bluetooth'?{transport:'bluetooth',...(typeof value.deviceId==='string'&&value.deviceId.length>0&&value.deviceId.length<=256?{deviceId:value.deviceId}:{})}:{};
}
