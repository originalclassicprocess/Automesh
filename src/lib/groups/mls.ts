import { p256 } from '@noble/curves/nist.js';
import {
  bytesToBase64, createApplicationMessage, createCommit, createGroup, decodeGroupState, decodeMlsMessage,
  defaultKeyPackageEqualityConfig, defaultLifetimeConfig, defaultPaddingConfig, emptyPskIndex, encodeGroupState,
  encodeMlsMessage, generateKeyPackageWithKey, getCiphersuiteFromName, getCiphersuiteImpl, joinGroup,
  processPublicMessage, zeroOutUint8Array, type ClientConfig, type ClientState, type Credential,
  type KeyPackage, type PrivateKeyPackage, type Proposal,
} from 'ts-mls';
import { unprotectPrivateMessage } from 'ts-mls/messageProtection.js';
import { leafToNodeIndex, toLeafIndex } from 'ts-mls/treemath.js';
import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
import type { IdentityProvider } from '$lib/identity/identity';
import { buildP256PKCS8 } from '$lib/identity/pkcs8';
import { bytesToHex } from '$lib/message/encoding';
import { GROUP_HISTORY, GROUP_KEY_HISTORY, encodedMls, groupMembers, uuid, type GroupCommit, type GroupLeave, type GroupOffer, type GroupPlan, type GroupProof, type GroupReady, type GroupReceipt } from './protocol';
import { epochOf, groupTimestamp, validPost, type GroupEntry, type GroupKeyDraft, type GroupPost, type GroupRoom } from './storage';

const suiteName = 'MLS_128_DHKEMP256_AES128GCM_SHA256_P256';
const text = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
let suite: ReturnType<typeof getCiphersuiteImpl> | undefined;
const cryptoSuite = () => suite ??= getCiphersuiteImpl(getCiphersuiteFromName(suiteName)).then(implementation => {
  const importPrivateKey: typeof implementation.hpke.importPrivateKey = async scalar => {
    // Apple's ECDH importer expects the SEC1 public point in PKCS#8.
    const pkcs8 = buildP256PKCS8(scalar) as Uint8Array<ArrayBuffer>;
    try {
      const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name:'ECDH', namedCurve:'P-256' }, true, ['deriveBits']);
      return key as Awaited<ReturnType<typeof implementation.hpke.importPrivateKey>>;
    } finally { pkcs8.fill(0); }
  };
  return {
    ...implementation,
    hpke: {
      ...implementation.hpke, importPrivateKey,
      async deriveKeyPair(ikm) {
        // RFC 9180 DHKEM(P-256, HKDF-SHA256) DeriveKeyPair. Import the same
        // scalar as the upstream provider, using WebKit-compatible PKCS#8.
        const material = hpkeInput('dkp_prk', ikm);
        let prk: Uint8Array;
        try { prk = await implementation.kdf.extract(new Uint8Array(), material); }
        finally { material.fill(0); }
        try {
          for (let counter = 0; counter < 256; counter++) {
            const candidate = await implementation.kdf.expand(prk, hpkeInput('candidate', Uint8Array.of(counter), true), 32);
            try {
              if (!p256.utils.isValidSecretKey(candidate)) continue;
              return {
                privateKey:await importPrivateKey(candidate),
                publicKey:await implementation.hpke.importPublicKey(p256.getPublicKey(candidate, false)),
              };
            } finally { candidate.fill(0); }
          }
          throw new Error('group_hpke_derivation_failed');
        } finally { prk.fill(0); }
      },
    },
  };
});
function hpkeInput(label: string, value: Uint8Array, expand = false) {
  const prefix = text.encode('HPKE-v1KEM\x00\x10' + label);
  const input = new Uint8Array((expand ? 2 : 0) + prefix.length + value.length);
  if (expand) input[1] = 32;
  input.set(prefix, expand ? 2 : 0);
  input.set(value, input.length - value.length);
  return input;
}
const bytes = (encoded: string) => Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
const encode = (value: unknown) => text.encode(JSON.stringify(value));
const leafProof = (room: string, signing: Uint8Array) => encode(['Automesh MLS leaf v1', room, bytesToBase64(signing)]);
const postProof = (room: string, post: GroupPost) => encode(['Automesh group post v1', room, post.id, post.from, post.text]);
const postEpochProof = (room: string, epoch: number, post: GroupPost) =>
  encode(['Automesh group post v2', room, epoch, post.id, post.from, post.text, post.sentAt ?? null, post.replyTo ?? null]);
const postReplyProof = (room: string, post: GroupPost) => encode(['Automesh group post reply v1', room, post.id, post.replyTo]);
const postTimeProof = (room: string, post: GroupPost) => encode(['Automesh group post time v1', room, post.id, post.sentAt]);
const welcomeProof = (room: GroupRoom, packet: string) => encode(['Automesh group welcome v1', room.id, room.title, room.members, packet]);
const receiptProof = (room: string, receipt: Pick<GroupReceipt, 'hash' | 'by' | 'state'>) =>
  encode(['Automesh group receipt v1', room, receipt.hash, receipt.by, receipt.state]);

async function verify(peer: string, publicKey: unknown, signature: unknown, data: Uint8Array) {
  try {
    if (!encodedMls(publicKey, 88) || !encodedMls(signature, 88)) return false;
    const keyBytes = bytes(publicKey), sig = bytes(signature);
    if (sig.length !== 64 || await accountIdFromPublicKey(keyBytes) !== peer) return false;
    const key = await crypto.subtle.importKey('raw', keyBytes, { name:'ECDSA', namedCurve:'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name:'ECDSA', hash:'SHA-256' }, key, sig, data as Uint8Array<ArrayBuffer>);
  } catch { return false; }
}

async function signProof(identity: IdentityProvider, data: Uint8Array): Promise<GroupProof> {
  return { publicKey:bytesToBase64(await identity.getPublicKeyBytes()), signature:bytesToBase64(await identity.sign(data)) };
}

export function signGroupWelcome(room: GroupRoom, packet: string, identity: IdentityProvider): Promise<GroupProof> {
  return signProof(identity, welcomeProof(room, packet));
}

export function verifyGroupWelcome(room: GroupRoom, packet: string, proof: GroupProof) {
  return verify(room.owner, proof.publicKey, proof.signature, welcomeProof(room, packet));
}

export async function signGroupReceipt(room: string, receipt: Pick<GroupReceipt, 'hash' | 'by' | 'state'>, identity: IdentityProvider): Promise<GroupReceipt> {
  return { ...receipt, ...await signProof(identity, receiptProof(room, receipt)) };
}

export function verifyGroupReceipt(room: string, receipt: GroupReceipt) {
  return verify(receipt.by, receipt.publicKey, receipt.signature, receiptProof(room, receipt));
}

type SignedMembership = GroupOffer | GroupPlan | GroupReady | GroupCommit | GroupLeave;
type UnsignedMembership<T = SignedMembership> = T extends SignedMembership ? Omit<T, 'proof'> : never;

function membershipProof(frame: UnsignedMembership) {
  const head = ['Automesh group membership v1', frame.type, frame.group, frame.epoch];
  switch (frame.type) {
    case 'group-leave': return encode([...head, frame.by]);
    case 'group-ready': return encode([...head, frame.change, frame.by]);
    case 'group-offer': return encode([...head, frame.change, frame.owner, frame.target, frame.title, frame.members]);
    case 'group-plan': return encode([...head, frame.change, frame.owner, frame.target, frame.nextOwner, frame.members, frame.key ?? null]);
    case 'group-commit': return encode([...head, frame.change, frame.packet, frame.welcome ?? null]);
  }
}

export async function signMembership<T extends UnsignedMembership>(frame: T, identity: IdentityProvider): Promise<T & { proof: GroupProof }> {
  return { ...frame, proof:await signProof(identity, membershipProof(frame)) };
}

export function verifyMembership(frame: SignedMembership, signer: string) {
  return verify(signer, frame.proof.publicKey, frame.proof.signature, membershipProof(frame));
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
    keyRetentionConfig: { retainKeysForGenerations: GROUP_HISTORY, retainKeysForEpochs: GROUP_KEY_HISTORY, maximumForwardRatchetSteps: 512 },
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
  if (decoder.decode(state.groupContext.groupId) !== room.id || state.groupContext.epoch !== BigInt(epochOf(room)) ||
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
  const keys = privateKeys(room.draft);
  try {
    const state = await joinGroup(message.welcome, readPackage(room.draft.packet), keys,
      emptyPskIndex, await cryptoSuite(), undefined, undefined, configForRoom);
    roster(room, state);
    return bytesToBase64(encodeGroupState(state));
  } finally { Object.values(keys).forEach(zeroOutUint8Array); }
}

function leafIndex(state: ClientState, peer: string): number {
  const node = state.ratchetTree.findIndex(node => node?.nodeType === 'leaf' && credentialProof(node.leaf.credential).peer === peer);
  if (node < 0) throw new Error('group_member_missing');
  return node / 2;
}

export async function createGroupChange(room: GroupRoom, plan: GroupPlan) {
  const allowed = [...new Set([...room.members, ...plan.members])];
  const state = { ...loadState(room), clientConfig:config({ ...room, members:allowed }) };
  const cipherSuite = await cryptoSuite();
  const proposal: Proposal = plan.key
    ? { proposalType:'add', add:{ keyPackage:readPackage(plan.key) } }
    : { proposalType:'remove', remove:{ removed:leafIndex(state, plan.target) } };
  const result = await createCommit({ state, cipherSuite }, {
    extraProposals:[proposal], ratchetTreeExtension:true, wireAsPublicMessage:true, authenticatedData:text.encode(plan.change),
  });
  try {
    roster({ ...room, members:plan.members, epoch:plan.epoch + 1 }, result.newState);
    return {
      mls:bytesToBase64(encodeGroupState(result.newState)),
      packet:bytesToBase64(encodeMlsMessage(result.commit)),
      welcome:result.welcome && bytesToBase64(encodeMlsMessage({ wireformat:'mls_welcome', version:'mls10', welcome:result.welcome })),
    };
  } finally { result.consumed.forEach(zeroOutUint8Array); }
}

export async function applyGroupChange(room: GroupRoom, plan: GroupPlan, commit: GroupCommit): Promise<string | undefined> {
  const state = loadState(room);
  const decoded = readPacket(commit.packet);
  if (decoded.wireformat !== 'mls_public_message') throw new Error('group_invalid_commit');
  const message = decoded.publicMessage, { content } = message;
  if (content.contentType !== 'commit' || content.sender.senderType !== 'member' ||
    content.sender.leafIndex !== leafIndex(state, plan.nextOwner) ||
    decoder.decode(content.groupId) !== room.id || content.epoch !== BigInt(plan.epoch) ||
    decoder.decode(content.authenticatedData) !== plan.change) throw new Error('group_invalid_commit');
  const allowed = [...new Set([...room.members, ...plan.members])];
  const result = await processPublicMessage({ ...state, clientConfig:config({ ...room, members:allowed }) },
    message, emptyPskIndex, await cryptoSuite(), action => {
      const proposal = action.kind === 'commit' && action.proposals.length === 1 ? action.proposals[0].proposal : undefined;
      if (!proposal) return 'reject';
      if (plan.key) return proposal.proposalType === 'add' &&
        bytesToBase64(encodeMlsMessage({ wireformat:'mls_key_package', version:'mls10', keyPackage:proposal.add.keyPackage })) === plan.key
        ? 'accept' : 'reject';
      return proposal.proposalType === 'remove' && proposal.remove.removed === leafIndex(state, plan.target) ? 'accept' : 'reject';
    });
  try {
    if (result.actionTaken !== 'accept') throw new Error('group_invalid_commit');
    if (result.newState.groupActiveState.kind === 'removedFromGroup') return undefined;
    roster({ ...room, members:plan.members, epoch:plan.epoch + 1 }, result.newState);
    return bytesToBase64(encodeGroupState(result.newState));
  } finally { result.consumed.forEach(zeroOutUint8Array); }
}

export async function groupPacketHash(packet: string): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes(packet))));
}

export async function encryptGroupPost(room: GroupRoom, post: GroupPost, identity: IdentityProvider) {
  const key = bytesToBase64(await identity.getPublicKeyBytes());
  // The original author proof keeps messages readable on older clients.
  const signature = bytesToBase64(await identity.sign(postProof(room.id, post)));
  const timeSignature = groupTimestamp(post.sentAt) ? bytesToBase64(await identity.sign(postTimeProof(room.id, post))) : undefined;
  const replySignature = post.replyTo ? bytesToBase64(await identity.sign(postReplyProof(room.id, post))) : undefined;
  const epochSignature = bytesToBase64(await identity.sign(postEpochProof(room.id, epochOf(room), post)));
  const result = await createApplicationMessage(loadState(room), encode({ ...post, key, signature, timeSignature, replySignature, epochSignature }), await cryptoSuite());
  result.consumed.forEach(zeroOutUint8Array);
  const packet = bytesToBase64(encodeMlsMessage({ wireformat:'mls_private_message', version:'mls10', privateMessage:result.privateMessage }));
  if (!encodedMls(packet, 6000)) throw new Error('group_text_too_long');
  return { mls:bytesToBase64(encodeGroupState(result.newState)), entry:{...post, packet, epoch:epochOf(room), audience:room.members, hash:await groupPacketHash(packet)} };
}

export async function decryptGroupPost(room: GroupRoom, packet: string, hash: string): Promise<{ mls: string; entry: GroupEntry }> {
  const message = readPacket(packet);
  if (message.wireformat !== 'mls_private_message' || message.privateMessage.contentType !== 'application' ||
    decoder.decode(message.privateMessage.groupId) !== room.id || message.privateMessage.epoch > BigInt(epochOf(room)))
    throw new Error('group_invalid_post');
  const epoch = Number(message.privateMessage.epoch);
  const audience = epoch === epochOf(room) ? room.members : room.changes?.find(change => change.plan.epoch === epoch)?.previous;
  if (!audience) throw new Error('group_invalid_post_epoch');
  const state = loadState(room);
  const historical = epoch !== epochOf(room);
  const previous = historical ? state.historicalReceiverData.get(BigInt(epoch)) : undefined;
  if (historical && !previous) throw new Error('group_invalid_post_epoch');
  const receiver = previous ?? {
    senderDataSecret:state.keySchedule.senderDataSecret, secretTree:state.secretTree,
    ratchetTree:state.ratchetTree, groupContext:state.groupContext,
  };
  const result = await unprotectPrivateMessage(receiver.senderDataSecret, message.privateMessage, receiver.secretTree,
    receiver.ratchetTree, receiver.groupContext, state.clientConfig.keyRetentionConfig, await cryptoSuite());
  const content = result.content.content;
  const { sender } = content;
  try {
    if (content.contentType !== 'application' || sender.senderType !== 'member') throw new Error('group_invalid_post');
    const leaf = receiver.ratchetTree[leafToNodeIndex(toLeafIndex(sender.leafIndex))];
    const post = JSON.parse(decoder.decode(content.applicationData)) as Partial<GroupPost & {
      key: string; signature: string; timeSignature: string; replySignature: string; epochSignature: string;
    }> | null;
    const { key, signature, timeSignature, replySignature, epochSignature } = post ?? {};
    // The authenticated MLS sender must match the author even for a legacy
    // post. A carrier forwards the original packet and never becomes its author.
    if (!validPost(post) || leaf?.nodeType !== 'leaf' || credentialProof(leaf.leaf.credential).peer !== post.from ||
        !room.members.includes(post.from) || !audience.includes(post.from) ||
        !await verify(post.from, key, signature, postProof(room.id, post))) throw new Error('group_invalid_author');
    const signedEpoch = epochSignature !== undefined;
    if (signedEpoch && !await verify(post.from, key, epochSignature, postEpochProof(room.id, epoch, post)))
      throw new Error('group_invalid_post_epoch_signature');
    const sentAt = groupTimestamp(post.sentAt) && (signedEpoch || await verify(post.from, key, timeSignature, postTimeProof(room.id, post)))
      ? post.sentAt : undefined;
    const replyTo = uuid(post.replyTo) && post.replyTo !== post.id &&
      (signedEpoch || await verify(post.from, key, replySignature, postReplyProof(room.id, post))) ? post.replyTo : undefined;
    const entry = { id:post.id, from:post.from, text:post.text, sentAt, replyTo, packet, hash, epoch, audience };
    const newState = previous
      ? { ...state, historicalReceiverData:new Map(state.historicalReceiverData).set(BigInt(epoch), { ...previous, secretTree:result.tree }) }
      : { ...state, secretTree:result.tree };
    return { mls:bytesToBase64(encodeGroupState(newState)), entry };
  } finally {
    if (content.contentType === 'application') content.applicationData.fill(0);
    result.consumed.forEach(zeroOutUint8Array);
  }
}
