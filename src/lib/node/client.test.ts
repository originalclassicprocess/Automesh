import { afterEach, describe, expect, it, vi } from 'vitest';
import { homeNodeUrl, requireNodeNetwork, normalizeNodeInfo, nodeResponseError, inspectHomeNode, signedNodeRequest } from './client';
import { NODE_PROTOCOL } from './protocol.js';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
describe('explicit home node addresses', () => {
  it('accepts secure explicit private endpoints', () => {
    expect(homeNodeUrl('https://192.168.1.4:3003/')).toBe('https://192.168.1.4:3003');
    expect(homeNodeUrl('https://localhost:3003/')).toBe('https://localhost:3003');
    expect(homeNodeUrl('https://node.automesh.space/')).toBe('https://node.automesh.space');
    expect(() => requireNodeNetwork('https://node.automesh.space/', true)).toThrow('internet_disabled');
    expect(() => requireNodeNetwork('https://192.168.1.4:3003/', true)).not.toThrow();
  });
  it('never downgrades TLS, discovers subnets or accepts credential/query redirects', () => {
    for (const url of ['http://192.168.1.4:3003', 'https://user:pass@localhost/',
      'https://localhost/?token=secret', 'https://localhost/#x', 'https://localhost/redirect']) expect(() => homeNodeUrl(url)).toThrow('invalid_node_url');
  });
});
describe('untrusted node boundary',()=>{
  const info={protocol:NODE_PROTOCOL,nodeId:'a'.repeat(32),capabilities:['opaque-mailbox'],paired:false};
  it('keeps only typed public information, including legacy nodes without optional fields',()=>{
    const normalized=normalizeNodeInfo({...info,privateKey:'not-public',adminToken:'not-public',role:'home',adminPanel:false});
    expect(normalized).toEqual({...info,chatOfflineDelivery:false,role:'home',adminPanel:false});
    expect(JSON.stringify(normalized)).not.toContain('not-public');
    for (const raw of [null,[],{...info,capabilities:['opaque-mailbox',{}]},{...info,capabilities:Array(33).fill('opaque-mailbox')},
      {...info,adminPanel:'false'},{...info,courierAddress:'not-an-account'},{...info,role:'fake'},
      {...info,fileQueue:{protocol:'automesh-attachment-v1',maxFileBytes:Infinity,chunkBytes:1}}]) expect(()=>normalizeNodeInfo(raw)).toThrow('node_protocol_invalid');
  });
  it('does not echo arbitrary remote errors even when they look like short codes',()=>{
    expect(nodeResponseError({error:'member_limit'})).toBe('member_limit');
    for (const error of ['private_secret_words','https://private.example','x'.repeat(1000),{},['bad']]) expect(nodeResponseError({error})).toBe('node_unavailable');
    expect(nodeResponseError(null)).toBe('node_unavailable');
  });
  it('accepts only allowlisted quota reasons and keeps old node errors compatible',()=>{
    expect(nodeResponseError({error:'mailbox_full'})).toBe('mailbox_full');
    expect(nodeResponseError({error:'mailbox_full',limit:'private_secret'})).toBe('mailbox_full');
    expect(nodeResponseError({error:'mailbox_full',limit:'__proto__'})).toBe('mailbox_full');
    for(const [limit,code] of Object.entries({node_files:'node_file_limit',profile_files:'profile_file_limit',storage:'node_storage_limit',node_messages:'node_message_limit',profile_messages:'profile_message_limit'}))
      expect(nodeResponseError({error:'mailbox_full',limit})).toBe(code);
    expect(nodeResponseError({error:'private_secret',limit:'storage'})).toBe('node_unavailable');
  });
  it('bounds response bytes and contains malformed JSON',async()=>{
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(new Uint8Array(512*1024+1))));
    await expect(inspectHomeNode('https://node.example',new AbortController().signal)).rejects.toThrow('node_response_limit');
    vi.stubGlobal('fetch',vi.fn(async()=>new Response('{private-bad-response')));
    await expect(inspectHomeNode('https://node.example',new AbortController().signal)).rejects.toThrow('node_response_invalid');
  });
  it('never signs or fetches a path outside the explicit protocol',async()=>{
    const identity=new WebCryptoIdentity(); await identity.create();
    const address=await accountIdFromPublicKey(await identity.getPublicKeyBytes()), fetch=vi.fn();vi.stubGlobal('fetch',fetch);
    const sign=vi.spyOn(identity,'sign');
    try { for (const path of ['@evil.example','/../admin/stop','/outbox/status?secret=value','//evil.example'])
      await expect(signedNodeRequest('https://node.example','a'.repeat(32),identity,address,path,{},new AbortController().signal)).rejects.toThrow('invalid_node_request');
      expect(fetch).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();
    } finally {identity.dispose();}
  });
  it('does not sign a challenge after cancellation while obtaining the public key',async()=>{
    const identity=new WebCryptoIdentity(); await identity.create(); const publicKey=await identity.getPublicKeyBytes();
    const address=await accountIdFromPublicKey(publicKey), abort=new AbortController();
    const fetch=vi.fn(async()=>new Response(JSON.stringify({nodeId:'a'.repeat(32),challenge:'b'.repeat(64)})));vi.stubGlobal('fetch',fetch);
    vi.spyOn(identity,'getPublicKeyBytes').mockImplementation(async()=>{abort.abort();return publicKey;});
    const sign=vi.spyOn(identity,'sign');
    try { await expect(signedNodeRequest('https://node.example','a'.repeat(32),identity,address,'/outbox/status',{},abort.signal)).rejects.toThrow('node_cancelled');
      expect(fetch).toHaveBeenCalledOnce();expect(sign).not.toHaveBeenCalled();
    } finally {identity.dispose();}
  });
});
