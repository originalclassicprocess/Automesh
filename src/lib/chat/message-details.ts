import { isValidAccountId } from '$lib/addressing/bech32m.js';
export const MESSAGE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ContactCard = { accountId: string; nickname: string };
export type ReplyReference = { id: string; from: string; preview: string };
export type ForwardReference = { sourceId: string; author?: ContactCard };
export type MessageDetails = {
  ephemeral?: { seconds?: number; views?: number; allowDownload: boolean };
  ephemeralOpened?: { targetId: string; viewedAt: number; views: number };
  media?: { kind: 'gif' | 'sticker' | 'sticker-pack' | 'pack-request'; packId?: string; packName?: string };
  reply?: ReplyReference;
  forwarded?: ForwardReference;
  contactCard?: ContactCard;
  // Public, signed radio route; never contains the radio channel PSK or seed.
  radioContact?: { invite: string; replyTo?: string };
  allowForwardAttribution?: boolean;
  // Authenticated control inside the same encrypted message queue. The actor
  // is the envelope sender; no caller-supplied owner can override another pin.
  pin?: { targetId: string | null; revision: number };
};
function name(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 32 && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
}
export function normalizeContactCard(raw: unknown): ContactCard | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>; const nickname = name(value.nickname);
  return typeof value.accountId === 'string' && isValidAccountId(value.accountId) && nickname !== null
    ? { accountId: value.accountId, nickname } : null;
}
// Strict bounded metadata. A forwarded attribution is a sender's claim, NOT
// a signature of the original author. Local aliases/public keys are never sent.
export function normalizeMessageDetails(raw: unknown): MessageDetails | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>; const result: MessageDetails = {};
  if (value.ephemeralOpened !== undefined) {
    const opened = value.ephemeralOpened as Record<string, unknown>;
    if (!opened || typeof opened !== 'object' || Array.isArray(opened) || Object.keys(value).length !== 1 ||
      Object.keys(opened).some(key => !['targetId','viewedAt','views'].includes(key)) ||
      typeof opened.targetId !== 'string' || !MESSAGE_ID.test(opened.targetId) ||
      !Number.isSafeInteger(opened.viewedAt) || (opened.viewedAt as number) < 1 ||
      !Number.isSafeInteger(opened.views) || (opened.views as number) < 1 || (opened.views as number) > 20) return null;
    return { ephemeralOpened: { targetId: opened.targetId, viewedAt: opened.viewedAt as number, views: opened.views as number } };
  }
  if (value.ephemeral !== undefined) {
    const rule = value.ephemeral as Record<string, unknown>;
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || typeof rule.allowDownload !== 'boolean' ||
      Object.keys(rule).some(key => !['seconds','views','allowDownload'].includes(key)) ||
      (rule.seconds === undefined && rule.views === undefined) ||
      (rule.seconds !== undefined && (!Number.isSafeInteger(rule.seconds) || (rule.seconds as number) < 5 || (rule.seconds as number) > 604800)) ||
      (rule.views !== undefined && (!Number.isSafeInteger(rule.views) || (rule.views as number) < 1 || (rule.views as number) > 20))) return null;
    result.ephemeral = { allowDownload: rule.allowDownload,
      ...(rule.seconds !== undefined ? { seconds: rule.seconds as number } : {}), ...(rule.views !== undefined ? { views: rule.views as number } : {}) };
  }
  if (value.pin !== undefined) {
    const pin = value.pin as Record<string, unknown>;
    if (!pin || typeof pin !== 'object' || Array.isArray(pin) ||
      !(pin.targetId === null || typeof pin.targetId === 'string' && MESSAGE_ID.test(pin.targetId)) ||
      !Number.isSafeInteger(pin.revision) || (pin.revision as number) < 1 ||
      Object.keys(value).some(key => key !== 'pin') || Object.keys(pin).some(key => !['targetId', 'revision'].includes(key))) return null;
    return { pin: { targetId: pin.targetId as string | null, revision: pin.revision as number } };
  }
  if (value.reply !== undefined) {
    const reply = value.reply as Record<string, unknown>;
    if (!reply || typeof reply.id !== 'string' || !MESSAGE_ID.test(reply.id) ||
      typeof reply.from !== 'string' || !isValidAccountId(reply.from) || typeof reply.preview !== 'string' || reply.preview.length > 280) return null;
    result.reply = { id: reply.id, from: reply.from, preview: reply.preview };
  }
  if (value.forwarded !== undefined) {
    const forwarded = value.forwarded as Record<string, unknown>;
    if (!forwarded || typeof forwarded.sourceId !== 'string' || !MESSAGE_ID.test(forwarded.sourceId)) return null;
    const author = forwarded.author === undefined ? undefined : normalizeContactCard(forwarded.author);
    if (author === null) return null;
    result.forwarded = { sourceId: forwarded.sourceId, ...(author ? { author } : {}) };
  }
  if (value.contactCard !== undefined) {
    const contact = normalizeContactCard(value.contactCard); if (!contact) return null;
    result.contactCard = contact;
  }
  if (value.radioContact !== undefined) {
    if (['ephemeral','ephemeralOpened','pin','media','contactCard'].some(key=>value[key]!==undefined)) return null;
    const radio = value.radioContact as Record<string, unknown>;
    if (!radio || typeof radio !== 'object' || Array.isArray(radio) ||
        Object.keys(radio).some(key => key !== 'invite' && key !== 'replyTo') ||
        typeof radio.invite !== 'string' || !radio.invite.startsWith('mesh-radio-contact1:') || radio.invite.length > 2400 ||
        (radio.replyTo !== undefined && (typeof radio.replyTo !== 'string' || !/^[a-f0-9]{32}$/.test(radio.replyTo)))) return null;
    result.radioContact = { invite: radio.invite, ...(radio.replyTo ? { replyTo: radio.replyTo as string } : {}) };
  }
  if (value.allowForwardAttribution !== undefined) {
    if (typeof value.allowForwardAttribution !== 'boolean') return null;
    result.allowForwardAttribution = value.allowForwardAttribution;
  }
  if (value.media !== undefined) {
    const media = value.media as Record<string, unknown>;
    if (!media || typeof media !== 'object' || !['gif', 'sticker', 'sticker-pack', 'pack-request'].includes(media.kind as string) ||
      Object.keys(media).some(key => !['kind', 'packId', 'packName'].includes(key)) ||
      (media.packId !== undefined && (typeof media.packId !== 'string' || !/^[0-9a-f]{64}$/.test(media.packId))) ||
      (media.packName !== undefined && (typeof media.packName !== 'string' || media.packName.length > 64 || /[\u0000-\u001f\u007f]/.test(media.packName))) ||
      (['sticker-pack','pack-request'].includes(media.kind as string) && (!media.packId || !media.packName)) ||
      (media.kind === 'sticker' && !!media.packId !== !!media.packName)) return null;
    result.media = { kind: media.kind as NonNullable<MessageDetails['media']>['kind'],
      ...(media.packId ? { packId: media.packId as string } : {}), ...(media.packName ? { packName: media.packName as string } : {}) };
  }
  return result;
}
export const RICH_PREFIX = '\u0000mesh-chat-v2:';
export const EPHEMERAL_PREFIX = '\u0000mesh-chat-v3:';
export function encodeChatContent(text: string, details?: MessageDetails): string {
  if (!details) return `\u0000mesh-chat-v1:${text}`;
  const valid = normalizeMessageDetails(details); if (!valid) throw new Error('invalid_message_details');
  // Ordinary text stays compatible with existing clients. New metadata needs
  // an updated receiver; it is never silently dropped as a fallback.
  if ((valid.pin || valid.ephemeralOpened) && text !== '') throw new Error('invalid_pin_content');
  if (!valid.pin && !valid.ephemeral && !valid.ephemeralOpened && !valid.reply && !valid.forwarded && !valid.contactCard && !valid.radioContact && !valid.media && valid.allowForwardAttribution !== false) return `\u0000mesh-chat-v1:${text}`;
  const content = (valid.ephemeral || valid.ephemeralOpened ? EPHEMERAL_PREFIX : RICH_PREFIX) + JSON.stringify({ text, details: valid });
  if (new TextEncoder().encode(content).length > 64 * 1024) throw new Error('message_too_large');
  return content;
}
export function decodeChatContent(content: string): { text: string; details?: MessageDetails } | null {
  if (content.startsWith('\u0000mesh-chat-v1:')) return { text: content.slice('\u0000mesh-chat-v1:'.length) };
  const prefix = content.startsWith(EPHEMERAL_PREFIX) ? EPHEMERAL_PREFIX : RICH_PREFIX;
  if (!content.startsWith(prefix) || new TextEncoder().encode(content).length > 64 * 1024) return null;
  try {
    const value = JSON.parse(content.slice(prefix.length));
    const details = normalizeMessageDetails(value.details);
    if (!details || (prefix === EPHEMERAL_PREFIX) !== !!(details.ephemeral || details.ephemeralOpened)) return null;
    return typeof value.text === 'string' && (!(details.pin || details.ephemeralOpened) || value.text === '') ? { text: value.text, details } : null;
  } catch { return null; }
}
