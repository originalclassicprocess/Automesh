import QRCode from 'qrcode';
import { WebCryptoIdentity } from '$lib/identity/webcrypto';
import { bytesToHex } from '$lib/message/encoding';
import { getAccountId } from '$lib/addressing/address';
import { ChatService } from '$lib/chat/ChatService';
import { sha256Hex } from '$lib/chat/file-transfer';
import { emptySessionChats, receiveMessage } from '$lib/chat/session-chats';
import { RoutedWebRTCTransport } from './RoutedWebRTCTransport';
import { encodeDirectInvite, decodeDirectInvite, directQrFrames, DirectQrCollector, type DirectInvite } from './direct-invite';
import { readQrFrame } from './qr-reader';

// Explicit, loopback-only developer check. Fresh disposable in-memory identities;
// no vault, user history, account recovery, WebSockets or external ICE service.
export async function checkDirectInBrowser(report: (message: string) => void, signal: AbortSignal,
  delayAfterAnswerMs = 0): Promise<void> {
  if (!['localhost', '127.0.0.1'].includes(location.hostname)) throw new Error('loopback_only');
  const wait = async (condition: () => boolean) => {
    const until = Date.now() + 20_000;
    while (!condition()) {
      if (signal.aborted) throw new Error('cancelled');
      if (Date.now() > until) throw new Error('browser_check_timeout');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };
  const identity = async () => {
    const provider = new WebCryptoIdentity(); const seed = crypto.getRandomValues(new Uint8Array(32));
    try { return { provider, address: await getAccountId(bytesToHex((await provider.fromSeed(seed)).publicKey)) }; }
    finally { seed.fill(0); }
  };
  const decodeQr = async (packet: DirectInvite): Promise<DirectInvite> => {
    const encoded = await encodeDirectInvite(packet); const collector = new DirectQrCollector(); let decoded: string | null = null;
    try {
      const full = new Image(); full.src = await QRCode.toDataURL(encoded,
        { width:720, margin:4, errorCorrectionLevel:'L' });
      await full.decode();
      if (readQrFrame(full, 720, 720) !== encoded) throw new Error('full_qr_not_readable');
      report(readQrFrame(full, 360, 360) === encoded
        ? `Полный ${packet.kind === 'offer' ? 'запрос' : 'ответ'} читается и в размере 360 px.`
        : `Полный ${packet.kind === 'offer' ? 'запрос' : 'ответ'} читается крупно; для маленького экрана используйте части.`);
    } catch (error) {
      if (error instanceof Error && error.message === 'full_qr_not_readable') throw error;
      report('Полный код слишком плотный; используется обмен частями.');
    }
    for (const frame of await directQrFrames(encoded)) {
      if (signal.aborted) throw new Error('cancelled');
      const image = new Image(); image.src = await QRCode.toDataURL(frame, { width:420, margin:4, errorCorrectionLevel:'M' });
      await image.decode();
      // Match the rendered 360px QR, not only the larger PNG's native resolution.
      const read = readQrFrame(image, 360, 360);
      if (!read) throw new Error('actual_qr_not_readable');
      decoded = await collector.add(read);
    }
    if (decoded !== encoded) throw new Error('qr_roundtrip_mismatch');
    return decodeDirectInvite(decoded);
  };
  const ai = await identity(); const bi = await identity();
  const ar = new RoutedWebRTCTransport([]); const br = new RoutedWebRTCTransport([]);
  const a = new ChatService(ar); const b = new ChatService(br);
  const abort = () => { void a.disconnect(); void b.disconnect(); };
  signal.addEventListener('abort', abort, { once:true });
  try {
    await a.init(ai); await b.init(bi);
    if (ar.getNodeStates().length || br.getNodeStates().length) throw new Error('unexpected_signaling');
    report('Два временных клиента созданы. Серверов подключения нет.');
    let aReady = false; let bReady = false;
    a.onPeerChange((_, event) => { aReady = event === 'joined'; });
    b.onPeerChange((_, event) => { bReady = event === 'joined'; });
    const offer = await decodeQr(await ar.createDirectOffer()); report('QR предложения сформированы и прочитаны из изображений.');
    const answer = await decodeQr(await br.acceptDirectOffer(offer)); report('QR ответа сформированы и прочитаны из изображений.');
    if (delayAfterAnswerMs > 0) {
      report(`Ответ сформирован. Проверяем ожидание ${delayAfterAnswerMs / 1000} секунд без чтения его QR.`);
      const until = Date.now() + delayAfterAnswerMs;
      while (Date.now() < until) {
        if (signal.aborted) throw new Error('cancelled');
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!br.hasPendingDirectPeer(ai.address)) throw new Error('responder_closed_before_answer_scanned');
      report('Ответ остаётся действительным; продолжаем обмен.');
    }
    await ar.acceptDirectAnswer(answer); await wait(() => aReady && bReady);
    report('Настоящие WebRTC DataChannel и защищённые MAE-сеансы установлены.');
    let history = emptySessionChats(); let incoming = 0; let replies = 0; let ack = false;
    const id = crypto.randomUUID();
    b.onMessage((message) => { incoming++; history = receiveMessage(history, { ...message, direction:'incoming' }); });
    a.onMessage(() => { replies++; }); a.onReceipt((_, messageId) => { if (messageId === id) ack = true; });
    await a.send('QR browser check', bi.address, id); await wait(() => incoming === 1 && ack);
    await b.send('QR reply check', ai.address); await wait(() => replies === 1);
    await a.send('QR browser check', bi.address, id); await wait(() => incoming === 2);
    if (history.byPeer[ai.address].messages.length !== 1) throw new Error('duplicate_message');
    report('Текст в обе стороны, подтверждение доставки, повтор без дубля — пройдено.');
    const fileId = crypto.randomUUID(); const bytes = crypto.getRandomValues(new Uint8Array(10_000));
    const hash = await sha256Hex(bytes); let offered = false; let chunk: Uint8Array | undefined;
    b.onFileOffer((_, offer) => { offered = offer.id === fileId && offer.sha256 === hash; });
    b.onFileChunk((_, receivedId, index, value) => { if (receivedId === fileId && index === 0) chunk = value; });
    await a.sendFileOffer({ id:fileId, name:'qr-test.bin', size:bytes.length, mime:'application/octet-stream', sha256:hash }, bi.address);
    await wait(() => offered); await a.sendFileChunk(fileId, 0, bytes, bi.address); await wait(() => !!chunk);
    if (await sha256Hex(chunk!) !== hash) throw new Error('file_hash_mismatch');
    ar.cancelPendingDirect(); br.cancelPendingDirect();
    await ar.configure([], false); await br.configure([], false);
    await b.send('QR stays connected', ai.address); await wait(() => replies === 2);
    report('Файл 10 КБ: хеш совпал. Закрытие QR/настройка серверов не оборвали живой канал.');
    report('ПРОЙДЕНО: прямой обмен QR, текст и файл без сигналинга/STUN/TURN.');
  } finally { signal.removeEventListener('abort', abort); await a.disconnect(); await b.disconnect(); }
}
