// Independent, consent-based historical transfer. No courier/device outbox,
// seed serializer, credential import or live message delivery callback here.
import { createDataBackup, openDataBackup, type DataBackupContents } from '../backup/data-backup';
import { disposeFullBackup, type BackupProfile, type BackupSummary } from '../backup/full-backup';
import { sha256Hex } from '../chat/file-transfer';
import { base64, unbase64 } from '../node/offline-crypto';
import { UUID_PATTERN } from '../core/objects';
import { isValidAccountId } from '../addressing/bech32m.js';
import { HISTORY_MAX_BYTES } from './history-data';

const PROTOCOL = 'automesh-device-history-v1', CHUNK = 16 * 1024, TTL = 30 * 60000;
type Offer = { protocol: typeof PROTOCOL; op: 'offer'; id: string; owner: string; device: string; bytes: number;
  hash: string; secret: string; expiresAt: number; summary: BackupSummary };
type Packet = Offer | { protocol: typeof PROTOCOL; op: 'ack'; id: string; ticket: string; next: number }
  | { protocol: typeof PROTOCOL; op: 'chunk'; id: string; ticket: string; index: number; data: string }
  | { protocol: typeof PROTOCOL; op: 'ready' | 'commit' | 'done' | 'cancel'; id: string; ticket: string };
export type HistoryStatus = { phase: 'idle' | 'preparing' | 'offered' | 'sending' | 'receiving' | 'verifying' | 'saving' | 'paused' | 'done' | 'error';
  received: number; total: number; summary?: BackupSummary; error?: string };
export const idleHistoryStatus = (): HistoryStatus => ({ phase: 'idle', received: 0, total: 0 });
const random = () => base64(crypto.getRandomValues(new Uint8Array(32)));
const token = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const exact = (value: object, fields: string[]) => Object.keys(value).sort().join(',') === fields.sort().join(',');
function packet(value: unknown): Packet {
  const p = value as Packet;
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.protocol !== PROTOCOL || !UUID_PATTERN.test(p.id)) throw new Error('history_packet');
  if (p.op === 'offer') {
    if (!exact(p, ['protocol','op','id','owner','device','bytes','hash','secret','expiresAt','summary']) || !isValidAccountId(p.owner) ||
      !isValidAccountId(p.device) || p.owner === p.device || !Number.isSafeInteger(p.bytes) || p.bytes < 56 || p.bytes > HISTORY_MAX_BYTES ||
      !/^[a-f0-9]{64}$/.test(p.hash) || !token(p.secret) || !Number.isSafeInteger(p.expiresAt) ||
      !p.summary || !exact(p.summary, ['profiles','contacts','messages','files','missingFiles']) || p.summary.profiles !== 1 ||
      Object.values(p.summary).some(v => !Number.isSafeInteger(v) || v < 0) || p.summary.contacts > 10000 || p.summary.messages > 100000 ||
      p.summary.files > 10000 || p.summary.missingFiles > 100000) throw new Error('history_packet');
  } else if (!('ticket' in p) || !token(p.ticket)) throw new Error('history_packet');
  else if (p.op === 'ack') {
    if (!exact(p, ['protocol','op','id','ticket','next']) || !Number.isSafeInteger(p.next) || p.next < 0 || p.next > Math.ceil(HISTORY_MAX_BYTES / CHUNK)) throw new Error('history_packet');
  } else if (p.op === 'chunk') {
    if (!exact(p, ['protocol','op','id','ticket','index','data']) || !Number.isSafeInteger(p.index) || p.index < 0 || p.index >= Math.ceil(HISTORY_MAX_BYTES / CHUNK) ||
      typeof p.data !== 'string' || p.data.length < 1 || p.data.length > Math.ceil(CHUNK * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(p.data)) throw new Error('history_packet');
  } else if (!['ready','commit','done','cancel'].includes(p.op) || !exact(p, ['protocol','op','id','ticket'])) throw new Error('history_packet');
  return p;
}
const brief = (op: 'ready' | 'commit' | 'done' | 'cancel', id: string, ticket: string): Packet => ({ protocol: PROTOCOL, op, id, ticket });
function lifetime(offer: Offer, now: number) { if (offer.expiresAt <= now || offer.expiresAt > now + TTL + 30000) throw new Error('history_expired'); }
export function historyError(error: unknown): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'history_expired') return 'Время переноса истекло. Начните заново; рабочие сообщения не затронуты.';
  if (code === 'history_access') return 'Доступ устройства отозван или истёк. Перенос остановлен.';
  if (code === 'history_cancelled') return 'Перенос остановлен. Рабочая переписка не изменена.';
  if (code === 'history_message_conflict' || code === 'history_file_conflict') return 'Найдены разные данные с одинаковым идентификатором. История не заменена.';
  if (code === 'history_capacity' || code === 'backup_too_large') return 'Превышен лимит переноса. Выберите меньше чатов или перенесите без вложений (до 128 МиБ за раз).';
  return 'Перенос не завершён. Проверьте свободное место и связь, затем повторите. Рабочая переписка не перезаписана.';
}
type Common = { owner: string; device: string; guard(): void; now?(): number; send(peer: string, value: unknown): Promise<void>;
  // Best-effort cancellation on an already authenticated channel, even while
  // its UI is being destroyed. Never reconnect or send archive data here.
  cancel?(peer: string, value: unknown): Promise<void>; update(status: HistoryStatus): void };
function notifyCancellation(options: Common, peer: string, offer: Offer | null, ticket: string) {
  if (offer) void (options.cancel ?? options.send)(peer, brief('cancel', offer.id, ticket || random())).catch(() => {});
}

export function createHistorySender(options: Common & { authorize(): Promise<void> }) {
  let offer: Offer | null = null, file: Blob | null = null, ticket = '', next = 0, highest = 0, committed = false, done = false, closed = false;
  let chain: Promise<unknown> = Promise.resolve(), pending = 0, ticking = false;
  const now = options.now ?? Date.now;
  const guard = () => { if (closed) throw new Error('history_closed'); options.guard(); if (offer) lifetime(offer, now()); };
  const state = (phase: HistoryStatus['phase'], error?: string) => options.update({ phase, received: Math.min(offer?.bytes ?? 0, next * CHUNK), total: offer?.bytes ?? 0,
    ...(offer ? { summary: offer.summary } : {}), ...(error ? { error } : {}) });
  const serial = <T>(work: () => Promise<T>) => { const result = chain.then(work); chain = result.catch(() => {}); return result; };
  async function transmit() {
    guard(); if (!offer || done) return;
    await options.authorize(); guard();
    try {
      if (!ticket) { await options.send(options.device, offer); state('offered'); }
      else if (committed) await options.send(options.device, brief('commit', offer.id, ticket));
      else if (next < Math.ceil(offer.bytes / CHUNK)) {
        const raw = new Uint8Array(await file!.slice(next * CHUNK, Math.min(offer.bytes, (next + 1) * CHUNK)).arrayBuffer()); guard();
        try { await options.send(options.device, { protocol: PROTOCOL, op: 'chunk', id: offer.id, ticket, index: next, data: base64(raw) }); }
        finally { raw.fill(0); }
        highest = Math.max(highest, next + 1); state('sending');
      }
    } catch { guard(); state('paused'); }
  }
  const fail = (error: unknown) => {
    // Only a fully prepared offer can resume. An interrupted preparation has
    // no retained archive/offer; report a retryable error instead of a stuck pause.
    if (error instanceof Error && error.message === 'history_paused' && offer && file) { state('paused'); return; }
    const old = offer, proof = ticket;
    file = null; offer = null; ticket = ''; done = true; state('error', historyError(error));
    notifyCancellation(options, options.device, old, proof);
  };
  return Object.freeze({
    async start(profile: BackupProfile) {
      return serial(async () => { try {
        guard(); if (offer) throw new Error('history_busy'); ticket = ''; next = 0; highest = 0; committed = false; done = false;
        state('preparing'); await options.authorize(); guard();
        const secret = random(), archive = await createDataBackup({ accountId: options.owner, profile, password: secret, guard }); guard();
        file = archive.file; const bytes = new Uint8Array(await file.arrayBuffer());
        let hash: string; try { hash = await sha256Hex(bytes); guard(); } finally { bytes.fill(0); }
        offer = { protocol: PROTOCOL, op: 'offer', id: crypto.randomUUID(), owner: options.owner, device: options.device, bytes: file.size,
          hash, secret, summary: archive.summary, expiresAt: now() + TTL };
        await transmit();
      } catch (error) { fail(error); } });
    },
    receive(peer: string, value: unknown) {
      if (closed || peer !== options.device || !offer || pending >= 4) return Promise.resolve();
      pending++; return serial(async () => { try {
        guard(); const p = packet(value); if (!offer || p.id !== offer.id || p.op === 'offer' || p.op === 'chunk') return;
        if (ticket && p.ticket !== ticket) return;
        if (p.op === 'cancel') { fail(new Error('history_cancelled')); return; }
        if (p.op === 'ack') {
          if (p.next > highest || ticket && p.next < next) return;
          ticket ||= p.ticket; next = p.next;
          // Yield between chunks: history must not monopolize the live channel.
          await new Promise(resolve => setTimeout(resolve, 25)); await transmit();
        } else if (p.op === 'ready' && ticket && next === Math.ceil(offer.bytes / CHUNK)) {
          await options.authorize(); guard(); committed = true; await transmit();
        } else if (p.op === 'done' && committed) { next = Math.ceil(offer.bytes / CHUNK); done = true; file = null; state('done'); offer = null; ticket = ''; }
      } catch (error) { if (!closed) fail(error); } }).finally(() => pending--);
    },
    tick() { if (ticking || closed) return Promise.resolve(); ticking = true;
      return serial(async () => { try { await transmit(); } catch (error) { if (!closed) fail(error); } }).finally(() => ticking = false); },
    close() { const old = offer, proof = ticket; closed = true; file = null; offer = null; ticket = '';
      if (!done) notifyCancellation(options, options.device, old, proof); }
  });
}

export function createHistoryReceiver(options: Common & { allowed(): boolean; commit(profile: BackupProfile): Promise<void> }) {
  let offer: Offer | null = null, ticket = '', pieces: Uint8Array[] = [], archive: DataBackupContents | null = null, done = false, closed = false, accepted = false;
  let chain: Promise<unknown> = Promise.resolve(), pending = 0, ticking = false; const now = options.now ?? Date.now;
  const guard = () => { if (closed) throw new Error('history_closed'); options.guard(); if (!options.allowed()) throw new Error('history_access'); if (offer) lifetime(offer, now()); };
  const state = (phase: HistoryStatus['phase'], error?: string) => options.update({ phase, received: Math.min(offer?.bytes ?? 0, pieces.length * CHUNK), total: offer?.bytes ?? 0,
    ...(offer ? { summary: offer.summary } : {}), ...(error ? { error } : {}) });
  const serial = <T>(work: () => Promise<T>) => { const result = chain.then(work); chain = result.catch(() => {}); return result; };
  function clean() { for (const bytes of pieces) bytes.fill(0); pieces = []; disposeFullBackup(archive ?? undefined); archive = null; }
  const fail = (error: unknown) => {
    if (error instanceof Error && ['history_paused','device_session_closed'].includes(error.message)) { state('paused'); return; }
    const old = offer, proof = ticket;
    state('error', historyError(error)); clean(); offer = null; ticket = ''; accepted = false; done = false;
    notifyCancellation(options, options.owner, old, proof);
  };
  async function reply() { guard(); if (!offer || !ticket) return;
    try {
      if (archive && !done) await options.send(options.owner, { protocol: PROTOCOL, op: 'ack', id: offer.id, ticket, next: pieces.length });
      guard(); await options.send(options.owner, done ? brief('done', offer.id, ticket) : archive ? brief('ready', offer.id, ticket)
        : { protocol: PROTOCOL, op: 'ack', id: offer.id, ticket, next: pieces.length });
    } catch { guard(); if (!done) state('paused'); }
  }
  return Object.freeze({
    receive(peer: string, value: unknown) {
      if (closed || peer !== options.owner || pending >= 4) return Promise.resolve();
      pending++; return serial(async () => { try {
        guard(); const p = packet(value);
        if (p.op === 'offer') {
          if (p.owner !== options.owner || p.device !== options.device) return;
          lifetime(p, now());
          if (done && offer?.id !== p.id) { clean(); offer = null; ticket = ''; accepted = false; done = false; }
          if (offer) {
            if (p.id !== offer.id) return;
            if (JSON.stringify(p) !== JSON.stringify(offer)) throw new Error('history_packet');
            if (accepted) await reply(); return;
          }
          offer = p; done = false; state('offered'); return;
        }
        if (!offer || p.id !== offer.id || ticket && p.ticket !== ticket) return;
        if (p.op === 'cancel') { fail(new Error('history_cancelled')); return; }
        if (!accepted) return;
        if (p.op === 'commit' && archive) {
          state('saving'); await options.commit(archive.profiles[0]); guard(); done = true; state('done'); clean(); await reply(); return;
        }
        if (done) { await reply(); return; }
        if (p.op !== 'chunk') return;
        if (p.index < pieces.length) {
          const bytes = unbase64(p.data), previous = pieces[p.index];
          try { if (bytes.length !== previous.length || bytes.some((v, i) => v !== previous[i])) throw new Error('history_packet'); } finally { bytes.fill(0); }
          await reply(); return;
        }
        if (p.index > pieces.length) { await reply(); return; }
        const bytes = unbase64(p.data), expected = Math.min(CHUNK, offer.bytes - p.index * CHUNK);
        if (expected <= 0 || bytes.length !== expected || base64(bytes) !== p.data) { bytes.fill(0); throw new Error('history_packet'); }
        pieces.push(bytes); state('receiving');
        if (pieces.length === Math.ceil(offer.bytes / CHUNK)) {
          state('verifying'); const blob = new Blob(pieces.map(value => new Uint8Array(value).buffer));
          const cipher = new Uint8Array(await blob.arrayBuffer());
          try { if (await sha256Hex(cipher) !== offer.hash) throw new Error('history_corrupt'); } finally { cipher.fill(0); }
          guard(); archive = await openDataBackup(blob, offer.secret, options.owner, guard); guard();
          if (JSON.stringify(archive.summary) !== JSON.stringify(offer.summary)) throw new Error('history_packet');
          // reply re-sends the final ACK together with ready, including after
          // interruption, before asking for a fresh owner-side permission check.
        }
        await reply();
      } catch (error) { if (!closed) fail(error); else clean(); } }).finally(() => pending--);
    },
    accept() { return serial(async () => { try { guard(); if (!offer || accepted) return; ticket = random(); accepted = true; state('receiving'); await reply(); }
      catch (error) { if (!closed) fail(error); } }); },
    tick() { if (ticking || closed) return Promise.resolve(); ticking = true;
      return serial(async () => { if (!offer || !accepted || done && offer.expiresAt <= now()) return; try { await reply(); } catch { if (!closed) { try { guard(); if (!done) state('paused'); } catch (error) { fail(error); } } } }).finally(() => ticking = false); },
    cancel() { return serial(async () => { const old = offer, proof = ticket, completed = done; clean(); offer = null; ticket = ''; accepted = false; done = false; state('idle');
      if (!completed) notifyCancellation(options, options.owner, old, proof); }); },
    close() { const old = offer, proof = ticket, completed = done; closed = true; clean(); offer = null; ticket = '';
      if (!completed) notifyCancellation(options, options.owner, old, proof); }
  });
}
