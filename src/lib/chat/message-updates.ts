import type {ChatEntry} from './session-chats';
import {MESSAGE_ID} from './message-details';
import type {MessageDetails} from './message-details';
import {REACTIONS} from './reactions';
export {REACTIONS} from './reactions';
export type ReactionView={emoji:string;actors:string[]};
export type PresentedMessage=ChatEntry&{edited?:boolean;editControl?:ChatEntry;reactions?:ReactionView[]};
export const isMessageUpdate=(m:ChatEntry)=>!!(m.details?.edit||m.details?.reaction);
export const reactionAllowed=(m:ChatEntry)=>MESSAGE_ID.test(m.id)&&!m.localCall&&!m.details?.ephemeral&&!isMessageUpdate(m);
export function editableText(m:ChatEntry):boolean{
 return MESSAGE_ID.test(m.id)&&!!m.text.trim()&&!m.file&&!m.localCall&&!m.radioDelivery&&!m.details?.ephemeral&&!m.details?.ephemeralOpened&&!m.details?.pin&&!m.details?.forwarded&&!m.details?.contactCard&&!m.details?.radioContact&&!m.details?.media&&!isMessageUpdate(m);
}
export function nextUpdateRevision(messages:readonly ChatEntry[],actor:string,targetId:string,kind:'edit'|'reaction'):number{
 let revision=0;for(const m of messages){const c=m.details?.[kind];if(m.from===actor&&c?.targetId===targetId)revision=Math.max(revision,c.revision);}
 if(!Number.isSafeInteger(revision+1))throw Error('message_update_revision_limit');return revision+1;
}
// Retrying an explicitly canceled/expired update must create a newer revision,
// but must never roll a newer edit/removal back or recreate a removed target.
export function retryMessageUpdate(messages:readonly ChatEntry[],m:ChatEntry,self:string):{text:string;details:MessageDetails}|null{
 const kind=m.details?.edit?'edit':m.details?.reaction?'reaction':undefined;
 if(!kind||m.from!==self||m.direction!=='outgoing')return null;
 const c=m.details![kind]!,target=messages.find(t=>t.id===c.targetId&&!isMessageUpdate(t));
 let latest:ChatEntry|undefined;for(const candidate of messages)if(candidate.from===self&&candidate.direction==='outgoing'&&candidate.details?.[kind]?.targetId===c.targetId&&newer(candidate,latest,kind))latest=candidate;
 if(latest?.id!==m.id)return null;
 if(!target||kind==='edit'&&!editableText(target)||kind==='reaction'&&!reactionAllowed(target))return null;
 const revision=nextUpdateRevision(messages,self,c.targetId,kind);if(revision-1!==c.revision)return null;
 return kind==='edit'?{text:m.text,details:{edit:{targetId:c.targetId,revision}}}:{text:'',details:{reaction:{...m.details!.reaction!,revision}}};
}
const newer=(a:ChatEntry,b:ChatEntry|undefined,kind:'edit'|'reaction')=>!b||a.details![kind]!.revision>b.details![kind]!.revision||a.details![kind]!.revision===b.details![kind]!.revision&&a.id>b.id;
// A projection over immutable originals + authenticated queued events. Events
// arriving before originals remain harmless and apply on a later projection.
// No replay can resurrect a deleted original or change its delivery/receipts.
export function presentMessages(messages:readonly ChatEntry[],self:string,peer:string):PresentedMessage[]{
 const originals=messages.filter(m=>!m.details?.pin&&!m.details?.ephemeralOpened&&!isMessageUpdate(m));
 if(!messages.some(isMessageUpdate))return originals;
 const byId=new Map(originals.map(m=>[m.id,m])),edits=new Map<string,ChatEntry>(),reactions=new Map<string,Map<string,ChatEntry>>();
 for(const m of messages){
  if(m.file||m.localCall||(m.direction==='outgoing'?m.from!==self:m.from!==peer))continue;
  const edit=m.details?.edit,reaction=m.details?.reaction,targetId=edit?.targetId??reaction?.targetId;
  if(!targetId)continue;const target=byId.get(targetId);if(!target||target.details?.ephemeral||target.localCall)continue;
  if(edit&&m.from===target.from&&editableText(target)&&m.text.trim()&&newer(m,edits.get(targetId),'edit'))edits.set(targetId,m);
  if(reaction&&m.text===''){
   const actors=reactions.get(targetId)??new Map<string,ChatEntry>();if(newer(m,actors.get(m.from),'reaction'))actors.set(m.from,m);reactions.set(targetId,actors);
  }
 }
 return originals.map(m=>{
  const edit=edits.get(m.id),actors=reactions.get(m.id),groups:ReactionView[]=[];
  if(!edit&&!actors)return m;
  if(actors)for(const emoji of REACTIONS){const who=[...actors.values()].filter(r=>r.details?.reaction?.emoji===emoji).map(r=>r.from).sort();if(who.length)groups.push({emoji,actors:who});}
  return edit||groups.length?{...m,...edit?{text:edit.text,edited:true,editControl:edit}:{},...groups.length?{reactions:groups}:{}}:m;
 });
}
