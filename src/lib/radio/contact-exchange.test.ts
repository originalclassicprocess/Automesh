import { describe,it,expect } from 'vitest';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { RadioCrypto,encodeRadioContact } from './crypto';
import { verifyChatRadioContact,matchingRadioReply } from './contact-exchange';
import { encodeChatContent,decodeChatContent,normalizeMessageDetails } from '$lib/chat/message-details';
import type { ChatEntry } from '$lib/chat/session-chats';

const network='a'.repeat(64);
async function fixture(){
  const alice=new WebCryptoIdentity(),bob=new WebCryptoIdentity();await alice.create();await bob.create();
  const a=await RadioCrypto.create(alice,network,100),b=await RadioCrypto.create(bob,network,200);
  const offer:ChatEntry={id:crypto.randomUUID(),from:a.contact.body.account,text:'LoRa',timestamp:Date.now(),direction:'outgoing',details:{radioContact:{invite:encodeRadioContact(a.contact)}}};
  const reply:ChatEntry={id:crypto.randomUUID(),from:b.contact.body.account,text:'LoRa',timestamp:Date.now(),direction:'incoming',details:{radioContact:{invite:encodeRadioContact(b.contact),replyTo:a.contact.body.keyId}}};
  return {a,b,offer,reply,close(){a.dispose();b.dispose();alice.dispose();bob.dispose();}};
}
describe('radio contact exchange through the ordinary encrypted chat',()=>{
  it('round-trips a bounded public card and ties its signature to the sender and selected radio network',async()=>{
    const p=await fixture();try{
      const encoded=encodeChatContent('LoRa',p.reply.details);
      expect(decodeChatContent(encoded)?.details).toEqual(p.reply.details);
      expect((await verifyChatRadioContact(p.reply.details!.radioContact!.invite,p.b.contact.body.account,network)).body.node).toBe(200);
      await expect(verifyChatRadioContact(p.reply.details!.radioContact!.invite,p.a.contact.body.account,network)).rejects.toThrow();
      await expect(verifyChatRadioContact(p.reply.details!.radioContact!.invite,p.b.contact.body.account,'b'.repeat(64))).rejects.toThrow();
      expect(normalizeMessageDetails({radioContact:{invite:'x'}})).toBeNull();
      expect(normalizeMessageDetails({radioContact:{invite:'mesh-radio-contact1:'+'x'.repeat(2400)}})).toBeNull();
      expect(normalizeMessageDetails({radioContact:{invite:p.reply.details!.radioContact!.invite,replyTo:'bad'}})).toBeNull();
      expect(normalizeMessageDetails({radioContact:{invite:p.reply.details!.radioContact!.invite,privateKey:'secret'}})).toBeNull();
    }finally{p.close();}
  });
  it('automates only a reply to this profile’s own sent offer, never unsolicited, forwarded, imported or unrelated replies',async()=>{
    const p=await fixture();try{
      expect(await matchingRadioReply(p.reply,[p.offer,p.reply],p.a.contact)).toBe(true);
      expect(await matchingRadioReply(p.reply,[p.reply],p.a.contact)).toBe(false);
      expect(await matchingRadioReply({...p.reply,importedFromDevice:true},[p.offer],p.a.contact)).toBe(false);
      expect(await matchingRadioReply({...p.reply,restoredFromBackup:true},[p.offer],p.a.contact)).toBe(false);
      expect(await matchingRadioReply({...p.reply,details:{...p.reply.details,forwarded:{sourceId:crypto.randomUUID()}}},[p.offer],p.a.contact)).toBe(false);
      expect(await matchingRadioReply(p.reply,[{...p.offer,restoredFromBackup:true}],p.a.contact)).toBe(false);
      expect(await matchingRadioReply({...p.reply,details:{radioContact:{...p.reply.details!.radioContact!,replyTo:'f'.repeat(32)}}},[p.offer],p.a.contact)).toBe(false);
      expect(await matchingRadioReply(p.reply,[{...p.offer,timestamp:p.reply.timestamp+300001}],p.a.contact)).toBe(false);
    }finally{p.close();}
  });
});
