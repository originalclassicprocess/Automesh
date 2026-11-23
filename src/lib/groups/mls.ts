import {
  bytesToBase64, createApplicationMessage, createCommit, createGroup, decodeGroupState, decodeMlsMessage,
  defaultKeyPackageEqualityConfig, defaultLifetimeConfig, defaultPaddingConfig, emptyPskIndex, encodeGroupState,
  encodeMlsMessage, generateKeyPackageWithKey, getCiphersuiteFromName, getCiphersuiteImpl, joinGroup,
  processPrivateMessage, zeroOutUint8Array, type ClientConfig, type ClientState, type Credential,
  type KeyPackage, type PrivateKeyPackage, type Proposal,
} from 'ts-mls';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import type { IdentityProvider } from '$lib/identity/identity';
import { bytesToHex } from '$lib/message/encoding';
import { GROUP_HISTORY, encodedMls, groupMembers } from './protocol';
import { validPost, type GroupEntry, type GroupKeyDraft, type GroupPost, type GroupRoom } from './storage';

const suiteName = 'MLS_128_DHKEMP256_AES128GCM_SHA256_P256';
const text = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
let suite: ReturnType<typeof getCiphersuiteImpl> | undefined;
const cryptoSuite = () => suite ??= getCiphersuiteImpl(getCiphersuiteFromName(suiteName));
const bytes = (encoded: string) => Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
const encode = (value: unknown) => text.encode(JSON.stringify(value));
const leafProof = (room: string, signing: Uint8Array) => encode(['Automesh MLS leaf v1', room, bytesToBase64(signing)]);
const postProof = (room: string, post: GroupPost) => encode(['Automesh group post v1', room, post.id, post.from, post.text]);

async function verify(peer: string, publicKey: unknown, signature: unknown, data: Uint8Array) {
  try {
    if (!encodedMls(publicKey, 88) || !encodedMls(signature, 88)) return false;
    const keyBytes = bytes(publicKey), sig = bytes(signature);
    if (sig.length !== 64 || await accountIdFromPublicKey(keyBytes) !== peer) return false;
    const key = await crypto.subtle.importKey('raw', keyBytes, { name:'ECDSA', namedCurve:'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name:'ECDSA', hash:'SHA-256' }, key, sig, data as Uint8Array<ArrayBuffer>);
  } catch { return false; }
}

function credentialProof(credential: Credential): { peer: string; publicKey: string; proof: string } {
  if (credential.credentialType !== 'basic' || credential.identity.length > 400) throw new Error('group_invalid_credential');
  return JSON.parse(decoder.decode(credential.identity));
}

function config(room: GroupRoom): ClientConfig {
  return {
    keyPackageEqualityConfig: defaultKeyPackageEqualityConfig,
    paddingConfig: defaultPaddingConfig,
    lifetimeConfig: defaultLifetimeConfig,
    keyRetentionConfig: { retainKeysForGenerations: GROUP_HISTORY, retainKeysForEpochs: 0, maximumForwardRatchetSteps: 512 },
    authService: { async validateCredential(credential, signing) {
      try {
        const claim = credentialProof(credential);
        return room.members.includes(claim.peer) && await verify(claim.peer, claim.publicKey, claim.proof, leafProof(room.id, signing));
      } catch { return false; }
    } },
  };
}

function readPacket(packet: string) {
  const raw = bytes(packet), decoded = decodeMlsMessage(raw, 0);
  if (!decoded || decoded[1] !== raw.length || decoded[0].version !== 'mls10') throw new Error('group_invalid_mls_packet');
  return decoded[0];
}

function readPackage(packet: string): KeyPackage {
  const decoded = readPacket(packet);
  if (decoded.wireformat !== 'mls_key_package' || decoded.keyPackage.cipherSuite !== suiteName) throw new Error('group_invalid_key_package');
  return decoded.keyPackage;
}

function roster(room: GroupRoom, state: ClientState) {
  const ids = state.ratchetTree.flatMap(node => node?.nodeType === 'leaf' ? [credentialProof(node.leaf.credential).peer] : []);
  if (decoder.decode(state.groupContext.groupId) !== room.id || state.groupContext.epoch !== 1n ||
    !groupMembers(ids) || !room.members.every(peer => ids.includes(peer)) || ids.length !== room.members.length)
    throw new Error('group_invalid_roster');
}

function loadState(room: GroupRoom): ClientState {
  if (!room.mls) throw new Error('group_not_ready');
  const raw = bytes(room.mls), decoded = decodeGroupState(raw, 0);
  if (!decoded || decoded[1] !== raw.length) throw new Error('group_invalid_local_state');
  return { ...decoded[0], clientConfig:config(room) };
}

export async function createGroupKey(room: GroupRoom, peer: string, identity: IdentityProvider): Promise<GroupKeyDraft> {
  const cs = await cryptoSuite();
  const signing = await cs.signature.keygen();
  const publicKey = bytesToBase64(await identity.getPublicKeyBytes());
  const proof = bytesToBase64(await identity.sign(leafProof(room.id, signing.publicKey)));
  const now = BigInt(Math.floor(Date.now() / 1000));
  const { publicPackage, privatePackage } = await generateKeyPackageWithKey(
    { credentialType:'basic', identity:encode({peer, publicKey, proof}) },
    { versions:['mls10'], ciphersuites:[suiteName], extensions:[], proposals:[], credentials:['basic'] },
    { notBefore:now - 300n, notAfter:now + 604800n }, [], signing, cs);
  const draft = { packet:bytesToBase64(encodeMlsMessage({ wireformat:'mls_key_package', version:'mls10', keyPackage:publicPackage })),
    init:bytesToBase64(privatePackage.initPrivateKey), leaf:bytesToBase64(privatePackage.hpkePrivateKey),
    signature:bytesToBase64(privatePackage.signaturePrivateKey) };
  Object.values(privatePackage).forEach(zeroOutUint8Array);
  return draft;
}

function privateKeys(draft: GroupKeyDraft): PrivateKeyPackage {
  return { initPrivateKey:bytes(draft.init), hpkePrivateKey:bytes(draft.leaf), signaturePrivateKey:bytes(draft.signature) };
}

export async function validateJoinKey(room: GroupRoom, peer: string, packet: string): Promise<boolean> {
  const key = readPackage(packet), { credential, signaturePublicKey } = key.leafNode;
  return credentialProof(credential).peer === peer && config(room).authService.validateCredential(credential, signaturePublicKey);
}

export async function establishGroup(room: GroupRoom, identity: IdentityProvider) {
  const cs = await cryptoSuite(), draft = await createGroupKey(room, room.owner, identity);
  const group = await createGroup(text.encode(room.id), readPackage(draft.packet), privateKeys(draft), [], cs, config(room));
  const additions: Proposal[] = room.members.filter(peer => peer !== room.owner).map(peer =>
    ({ proposalType:'add', add:{ keyPackage:readPackage(room.keys[peer]) } }));
  const result = await createCommit({ state:group, cipherSuite:cs }, { extraProposals:additions, ratchetTreeExtension:true });
  result.consumed.forEach(zeroOutUint8Array);
  roster(room, result.newState);
  if (!result.welcome) throw new Error('group_missing_welcome');
  return {
    mls:bytesToBase64(encodeGroupState(result.newState)),
    welcome:bytesToBase64(encodeMlsMessage({ wireformat:'mls_welcome', version:'mls10', welcome:result.welcome })),
  };
}

export async function acceptGroupWelcome(room: GroupRoom, packet: string): Promise<string> {
  const message = readPacket(packet);
  if (message.wireformat !== 'mls_welcome' || !room.draft) throw new Error('group_invalid_welcome');
  const configForRoom = config(room);
  const state = await joinGroup(message.welcome, readPackage(room.draft.packet), privateKeys(room.draft),
    emptyPskIndex, await cryptoSuite(), undefined, undefined, configForRoom);
  roster(room, state);
  return bytesToBase64(encodeGroupState(state));
}

export async function groupPacketHash(packet: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(packet))));
}

export async function encryptGroupPost(room: GroupRoom, post: GroupPost, identity: IdentityProvider) {
  const key = bytesToBase64(await identity.getPublicKeyBytes());
  const signature = bytesToBase64(await identity.sign(postProof(room.id, post)));
  const result = await createApplicationMessage(loadState(room), encode({ ...post, key, signature }), await cryptoSuite());
  result.consumed.forEach(zeroOutUint8Array);
  const packet = bytesToBase64(encodeMlsMessage({ wireformat:'mls_private_message', version:'mls10', privateMessage:result.privateMessage }));
  if (!encodedMls(packet, 6000)) throw new Error('group_text_too_long');
  return { mls:bytesToBase64(encodeGroupState(result.newState)), entry:{...post, packet, hash:await groupPacketHash(packet)} };
}

export async function decryptGroupPost(room: GroupRoom, packet: string, hash: string): Promise<{ mls: string; entry: GroupEntry }> {
  const message = readPacket(packet);
  if (message.wireformat !== 'mls_private_message' || message.privateMessage.contentType !== 'application' ||
    decoder.decode(message.privateMessage.groupId) !== room.id || message.privateMessage.epoch !== 1n)
    throw new Error('group_invalid_post');
  const result = await processPrivateMessage(loadState(room), message.privateMessage, emptyPskIndex, await cryptoSuite());
  if (result.kind !== 'applicationMessage') throw new Error('group_invalid_post');
  try {
    const post = JSON.parse(decoder.decode(result.message)) as Partial<GroupPost & { key: string; signature: string }> | null;
    const key = post?.key, signature = post?.signature;
    // The public MLS API returns plaintext without the sender's leaf index.
    // This inner proof preserves authorship when an existing member relays it.
    if (!validPost(post) || !room.members.includes(post.from) || !await verify(post.from, key, signature, postProof(room.id, post)))
      throw new Error('group_invalid_author');
    const entry = { id:post.id, from:post.from, text:post.text, packet, hash };
    return { mls:bytesToBase64(encodeGroupState(result.newState)), entry };
  } finally {
    result.message.fill(0);
    result.consumed.forEach(zeroOutUint8Array);
  }
}
