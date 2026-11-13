import { expect, it } from 'vitest';
import { emptySessionChats, ensureConversation, type ChatEntry } from '$lib/chat/session-chats';
import { localOutgoing, pendingFile, pendingFileOffer, pendingText, peerNeedsRecovery } from './delivery-work';

const message: ChatEntry = {id:'m',from:'me',direction:'outgoing',text:'hello',timestamp:1,delivery:'queued'};
it.each<Partial<ChatEntry>>([
  {delivery:'saving'}, {restoredFromBackup:true}, {importedFromDevice:true}, {deviceMessage:true}, {radioDelivery:'received'},
  {localCall:{} as ChatEntry['localCall']}, {nodeQueue:'canceling'}, {nodeQueue:'canceled'}, {nodeQueue:'expired'}, {direction:'incoming'},
])('keeps history/other delivery work out of a primary reconnect: %j', patch => {
  expect(localOutgoing({...message,...patch})).toBe(false);
  expect(pendingText({...message,...patch})).toBe(false);
});
it('recovers live text and unfinished files but never resurrects deleted/completed files or blocked contacts', () => {
  const file = {...message,file:{id:'f',name:'x',mime:'text/plain',size:1,sha256:'0'.repeat(64)},fileStatus:'offered' as const};
  expect(pendingText(message)).toBe(true); expect(pendingText(file)).toBe(false);
  expect(pendingFileOffer(file)).toBe(true);
  expect(pendingFile({...file,delivery:'saving'})).toBe(false);
  for (const fileStatus of ['ready','rejected','canceled'] as const) expect(pendingFile({...file,fileStatus})).toBe(false);
  expect(pendingFile({...file,fileDeleted:true})).toBe(false);
  const c = ensureConversation(emptySessionChats(),'p').byPeer.p;
  for (const contact of ['blocked','pending'] as const) expect(peerNeedsRecovery({...c,contact,messages:[message]})).toBe(false);
  expect(peerNeedsRecovery({...c,contact:'new',messages:[{...message,importedFromDevice:true}]})).toBe(false);
  expect(peerNeedsRecovery({...c,contact:'accepted'})).toBe(true);
});
