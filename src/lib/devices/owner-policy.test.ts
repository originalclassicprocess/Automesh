import { it,expect } from 'vitest';
import { signOwnerPolicy,verifyOwnerPolicy } from './owner-policy';
import { WebCryptoIdentity } from '../identity/webcrypto';
import { accountIdFromPublicKey } from '../addressing/account-id.js';
import { webCryptoEnvironment } from '../core/ports';
import { signMembership, MEMBERSHIP_TYPE } from './membership';
it('requires fresh owner proof bound to the exact nonce, recipient, roster digest and root identity', async () => {
  const signer = new WebCryptoIdentity(), other = new WebCryptoIdentity(); await signer.create(); await other.create();
  const owner = await accountIdFromPublicKey(await signer.getPublicKeyBytes()), recipient = await accountIdFromPublicKey(await other.getPublicKeyBytes());
  const env = webCryptoEnvironment(), nonce='a'.repeat(64), anchor={owner,sequence:0,digest:null,revoked:[]};
  try {
    const roster = await signMembership({type:MEMBERSHIP_TYPE,sequence:1,previous:null,epoch:0,primary:true,devices:[]},signer,env);
    const reply = await signOwnerPolicy(roster,nonce,recipient,signer,env);
    await expect(verifyOwnerPolicy(reply,owner,recipient,nonce,anchor,env)).resolves.toMatchObject({roster});
    await expect(verifyOwnerPolicy(reply,owner,recipient,'b'.repeat(64),anchor,env)).rejects.toThrow();
    await expect(verifyOwnerPolicy(reply,owner,owner,nonce,anchor,env)).rejects.toThrow();
    await expect(verifyOwnerPolicy(reply,owner,recipient,nonce,anchor,{...env,now:()=>env.now()+31000})).rejects.toThrow();
    await expect(signOwnerPolicy(roster,nonce,recipient,other,env)).rejects.toThrow();
    const changed={...reply,roster:await signMembership({type:MEMBERSHIP_TYPE,sequence:1,previous:null,epoch:0,primary:false,devices:[]},signer,env)};
    await expect(verifyOwnerPolicy(changed,owner,recipient,nonce,anchor,env)).rejects.toThrow();
  } finally {signer.dispose();other.dispose();}
});
