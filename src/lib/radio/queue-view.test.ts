import { describe, expect, it } from 'vitest';
import { emptySessionChats, ensureConversation, updateConversation, type ChatEntry } from '$lib/chat/session-chats';
import { messageStatus } from '$lib/chat/message-presentation';
import { chatActivity } from '$lib/chat/chat-activity';
import { radioQueueView } from './queue-view';

const base:ChatEntry={id:'one',from:'self',text:'hello',timestamp:1,direction:'outgoing',delivery:'queued'};
describe('radio queue presentation',()=>{
  it('removes completed work from the indicator without removing history and retains unconfirmed board receipts',()=>{
    const messages:ChatEntry[]=[{...base,radioDelivery:'received',delivery:'delivered'},
      {...base,id:'read',radioDelivery:'received',delivery:'read'},
      {...base,id:'board',radioDelivery:'board'}, {...base,id:'retry',radioDelivery:'retry'},
      {...base,id:'transmitting',radioDelivery:'transmitting'}, {...base,id:'awaiting',radioDelivery:'awaiting'}];
    const chats=updateConversation(ensureConversation(emptySessionChats(),'peer'),'peer',c=>({...c,messages}));
    expect(radioQueueView(chats).map(i=>i.kind)).toEqual(['board','retry','sending','awaiting']);
    expect(chats.byPeer.peer.messages).toHaveLength(6);
    expect(radioQueueView(updateConversation(chats,'peer',c=>({...c,messages:messages.map(m=>({...m,delivery:'delivered'}))})))).toEqual([]);
  });
  it('uses yellow for work, red for failure and green for recipient-board evidence in both messages and chat rows',()=>{
    for(const radioDelivery of ['queued','transmitting','awaiting'] as const){
      expect(messageStatus({...base,radioDelivery}).tone).toBe('warning');
      expect(chatActivity([{...base,radioDelivery}])?.tone).toBe('warning');
    }
    for(const radioDelivery of ['retry','stopped'] as const){
      expect(messageStatus({...base,radioDelivery}).tone).toBe('error');
      expect(chatActivity([{...base,radioDelivery}])?.tone).toBe('danger');
    }
    expect(messageStatus({...base,radioDelivery:'board'})).toMatchObject({label:'Принято платой собеседника',tone:'success'});
    expect(chatActivity([{...base,radioDelivery:'board'}])?.tone).toBe('success');
    expect(chatActivity([{...base,radioDelivery:'retry'},{...base,id:'other',radioDelivery:'transmitting'}])?.tone).toBe('danger');
  });
});
