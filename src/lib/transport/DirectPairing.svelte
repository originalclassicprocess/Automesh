<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import QrInput from '$lib/application/QrInput.svelte';
  import { onDestroy } from 'svelte';
  import QRCode from 'qrcode';
  import NodeScanner from './NodeScanner.svelte';
  import { readQrImage } from './qr-reader';
  import { DIRECT_LIFETIME_MS, DirectQrCollector, decodeDirectInvite, encodeDirectInvite, directQrFrames, type DirectInvite } from './direct-invite';
  import type { RoutedWebRTCTransport } from './RoutedWebRTCTransport';
  import { identiconFor } from '$lib/addressing/identicon';
  let { transport, ownAddress, connections, preparePeer, openChat }: {
    transport: RoutedWebRTCTransport | null; ownAddress: string;
    connections: Record<string, string>; preparePeer: (peer: string) => void; openChat: (peer: string) => void;
  } = $props();
  const collector = new DirectQrCollector();
  let busy = $state(false); let error = $state(''); let input = $state('');
  let preview = $state<DirectInvite | null>(null); let output = $state<DirectInvite | null>(null);
  let encoded = $state(''); let frames = $state<string[]>([]); let singleImage = $state('');
  let images = $state<string[]>([]); let part = $state(0);
  let displayMode = $state<'single' | 'parts'>('single'); let showingOutput = $state(false);
  let progress = $state(''); let seenParts = $state<number[]>([]); let partCount = $state(0);
  let scanning = $state(false); let copied = $state(false);
  let peer = $state(''); let expires = $state(0); let help = $state(false);
  let peerWaitStarted = $state(0);
  let generation = 0; let decodeQueue: Promise<void> = Promise.resolve();
  let now = $state(Date.now());
  const clock = setInterval(() => { now = Date.now(); }, 1000);
  let connected = $derived(!!peer && connections[peer] === 'connected');
  let qrExpired = $derived(expires > 0 && now >= expires && !connected);
  // A signed answer can still arrive after the offer QR has stopped being valid.
  let expired = $derived(expires > 0 && now >= expires + (output?.kind === 'offer' ? DIRECT_LIFETIME_MS : 0) && !connected);
  let failed = $derived(!!peer && !connected && !expired &&
    (!transport?.hasPendingDirectPeer(peer) || (peerWaitStarted > 0 && now - peerWaitStarted > 30_000)));
  onDestroy(() => { generation++; clearInterval(clock); if (failed && peer) transport?.closeDirectPeer(peer); transport?.cancelPendingDirect(); });

  function readableError(value: unknown): string {
    const code = value instanceof Error ? value.message : '';
    if (code === 'direct_no_candidates' || code === 'direct_gather_timeout')
      return 'Браузер не предоставил локальные адреса WebRTC. Проверьте разрешение WebRTC и доступ к Wi-Fi (в Vivaldi — трансляцию IP).';
    if (code === 'direct_wrong_answer') return 'Ответ не относится к вашему действующему предложению. Создайте новое предложение и обменяйтесь QR заново.';
    if (code === 'direct_offer_expired') return 'Предложение устарело во время подготовки ответа. Попросите создать новое.';
    if (code === 'direct_already_connected') return 'Прямое QR-соединение с этим аккаунтом уже работает.';
    if (code === 'direct_peer_limit') return 'Достигнут лимит прямых соединений (8).';
    if (code === 'direct_qr_different_session') return 'Это части разных QR. Нажмите «Сбросить прочитанные части» и сканируйте один комплект.';
    if (code === 'blocked_peer') return 'Этот аккаунт заблокирован. Сначала снимите блокировку в его карточке.';
    return 'Не удалось подключиться: QR повреждён, устарел или не подходит. Проверьте аккаунт и повторите обмен.';
  }
  async function showPacket(packet: DirectInvite, token: number): Promise<void> {
    const text = await encodeDirectInvite(packet);
    const parts = await directQrFrames(text);
    let one = '';
    try { one = await QRCode.toDataURL(text, { width: 720, margin: 4, errorCorrectionLevel: 'L' }); }
    catch { /* Some unusually long offers exceed the capacity of one QR. */ }
    if (token !== generation) return;
    output = packet; encoded = text; frames = parts; singleImage = one; images = [];
    part = 0; displayMode = one ? 'single' : 'parts'; showingOutput = true;
    copied = false; expires = packet.expires;
    if (!one) await showParts(token);
  }
  async function showParts(token = generation): Promise<void> {
    busy = true; error = '';
    try {
      const qr = await Promise.all(frames.map((frame) => QRCode.toDataURL(frame,
        { width: 420, margin: 4, errorCorrectionLevel: 'M' })));
      if (token !== generation) return;
      images = qr; part = 0; displayMode = 'parts'; showingOutput = true;
    } catch (e) { if (token === generation) error = readableError(e); }
    finally { if (token === generation) busy = false; }
  }
  function finishShowing(): void {
    if (!output) return;
    showingOutput = false;
    if (output.kind === 'offer') { collector.reset(); progress = ''; seenParts = []; partCount = 0; scanning = true; }
  }
  async function create(): Promise<void> {
    if (!transport || busy) return;
    if (failed && peer) transport.closeDirectPeer(peer);
    const token = ++generation; busy = true; error = ''; preview = null; scanning = false;
    output = null; images = []; frames = []; singleImage = ''; encoded = ''; showingOutput = false;
    peer = ''; peerWaitStarted = 0; expires = 0; collector.reset(); progress = ''; seenParts = []; partCount = 0;
    try { await showPacket(await transport.createDirectOffer(), token); }
    catch (e) { if (token === generation) error = readableError(e); }
    finally { if (token === generation) busy = false; }
  }
  function read(text: string): void {
    const token = generation;
    decodeQueue = decodeQueue.catch(() => {}).then(async () => {
      if (token !== generation) return;
      try {
        const full = await collector.add(text.trim());
        if (token !== generation) return;
        progress = collector.progress; seenParts = collector.seenParts; partCount = collector.partCount; error = '';
        if (!full) return;
        const packet = await decodeDirectInvite(full);
        if (token !== generation) return;
        if (packet.from === ownAddress || (packet.kind === 'answer' && packet.to !== ownAddress)) throw new Error('wrong_account');
        preview = packet; scanning = false; showingOutput = false;
        progress = ''; seenParts = []; partCount = 0; input = '';
      } catch (e) { if (token === generation) error = readableError(e); }
    });
  }
  async function upload(event: Event): Promise<void> {
    const fileInput = event.currentTarget as HTMLInputElement; const file = fileInput.files?.[0]; fileInput.value = '';
    if (!file || busy) return;
    const token = generation;
    try { const text = await readQrImage(file); if (token === generation) read(text); }
    catch { if (token === generation) error = 'QR не найден. Выберите PNG/JPEG/WebP до 5 МБ.'; }
  }
  async function confirm(): Promise<void> {
    if (!preview || !transport || busy) return;
    const token = generation; const packet = preview; busy = true; error = '';
    try {
      preparePeer(packet.from);
      if (packet.kind === 'offer') {
        const answer = await transport.acceptDirectOffer(packet);
        if (token !== generation) return;
        // Showing and reading the response can take minutes; start the short
        // connection timeout only after the initiator applies the answer.
        peer = packet.from; peerWaitStarted = 0; await showPacket(answer, token);
      } else {
        await transport.acceptDirectAnswer(packet);
        if (token !== generation) return;
        peer = packet.from; peerWaitStarted = Date.now();
      }
      preview = null;
    } catch (e) { if (token === generation) error = readableError(e); }
    finally { if (token === generation) busy = false; }
  }
  function reset(): void {
    if (failed && peer) transport?.closeDirectPeer(peer);
    generation++; transport?.cancelPendingDirect(); collector.reset(); preview = null; output = null;
    images = []; frames = []; singleImage = ''; encoded = ''; input = ''; peer = ''; peerWaitStarted = 0;
    showingOutput = false; progress = ''; seenParts = []; partCount = 0; error = ''; expires = 0; scanning = false; busy = false;
  }
  async function copy(): Promise<void> {
    const token = generation;
    try { await navigator.clipboard.writeText(encoded); if (token === generation) copied = true; }
    catch { if (token === generation) error = 'Не удалось скопировать. Можно выделить код подключения вручную.'; }
  }
</script>

<div class="direct-pairing">
  <h4>{$i18n.text("Напрямую через QR")}</h4>
  <p>{$i18n.text("Оба устройства должны быть в одной Wi-Fi-сети. Сервер подключения не нужен.")}</p>
  <HelpInfo label={$i18n.text("Справка: прямое QR-подключение")} text={$i18n.text("Первый пользователь показывает предложение: сначала один полный QR, при трудностях — несколько более простых QR. Второй читает его и подтверждает аккаунт, затем показывает ответ. Первый читает ответ и подтверждает. Для показа предложения есть 5 минут; ответ получает свои отдельные 5 минут с момента создания. Если предложение уже принято, его ответ можно считать и после окончания показа предложения. До завершения обмена оставайтесь в этом разделе. QR содержит подписанные параметры связи, включая сетевые адреса, но не seed и не ключи переписки. При обрыве/перезапуске нужен новый обмен. QR не обходит изоляцию Wi-Fi, запреты VPN или WebRTC. Сравнивайте полный Mesh ID нужного человека.")} open={help} onToggle={() => help = !help} />
  <div class="actions">
    <button type="button" onclick={create} disabled={busy || !transport || (!!output && !expired && !failed && !connected)}>{busy ? $i18n.text("Подготавливаем…") : $i18n.text("Создать предложение")}</button>
  </div>
  {#if scanning}<NodeScanner continuous label={$i18n.text("Сканирование прямого подключения")} onResult={read} onClose={() => scanning = false}
    {seenParts} {partCount} onResetProgress={() => { collector.reset(); progress = ''; seenParts = []; partCount = 0; error = ''; }} />{/if}
  <QrInput bind:value={input} label={$i18n.text("Код прямого подключения")} placeholder={$i18n.text("Вставьте код предложения или ответа")} multiline maxlength={16000} disabled={busy}
    onScan={()=>{scanning=!scanning;if(scanning)showingOutput=false;error='';}} onImage={upload} />
  <button type="button" onclick={() => read(input)} disabled={busy || !input.trim()}>{$i18n.text("Прочитать код")}</button>
  {#if progress && !scanning}<p aria-live="polite">{$i18n("m_d237f5bbd840", {v0: (progress)})}</p><button type="button" onclick={() => { collector.reset(); progress = ''; seenParts = []; partCount = 0; error = ''; }}>{$i18n.text("Сбросить прочитанные части")}</button>{/if}
  {#if preview}
    <div class="confirmation">
      <p>{preview.kind === 'offer' ? $i18n.text("Предложение от аккаунта") : $i18n.text("Ответ от аккаунта")}</p>
      <img src={identiconFor(preview.from)} alt={$i18n.text("Узор аккаунта для подключения")} width="48" height="48" />
      <code>{preview.from}</code>
      <p>{$i18n.text("Подпись проверена. Это нужный собеседник?")}</p>
      <button type="button" onclick={confirm} disabled={busy}>{preview.kind === 'offer' ? $i18n.text("Подтвердить и создать ответ") : $i18n.text("Подтвердить ответ и соединиться")}</button>
      <button type="button" onclick={() => preview = null} disabled={busy}>{$i18n.text("Отклонить")}</button>
    </div>
  {/if}
  {#if output && !expired && !connected && !failed}
    <h4>{output.kind === 'offer' ? $i18n.text("Ваше предложение") : $i18n.text("Ваш ответ")}</h4>
    {#if showingOutput && !qrExpired}
      <p>{output.kind === 'offer' ? $i18n.text("Покажите QR собеседнику, затем перейдите к чтению ответа.") : $i18n.text("Покажите ответ первому пользователю и дождитесь соединения.")}</p>
      {#if displayMode === 'single' && singleImage}
        <img src={singleImage} alt={$i18n("m_7cff1fe4903c", {v0: (output.kind === 'offer' ? $i18n.text("предложения") : $i18n.text("ответа"))})} width="720" height="720" />
        <p>{$i18n.text("Не считывается? Покажите код несколькими простыми QR.")}</p>
        <button type="button" onclick={() => void showParts()} disabled={busy}>{$i18n("m_88b7691a7cd7", {v0: (frames.length)})}</button>
      {:else}
        {#if images[part]}<img src={images[part]} alt={$i18n("m_b8f9624ce5d9", {v0: (output.kind === 'offer' ? $i18n.text("предложения") : $i18n.text("ответа")), v1: (part + 1), v2: (images.length)})} width="420" height="420" />{/if}
        <div class="actions">
          {#if images.length > 1}<button type="button" onclick={() => part = (part + images.length - 1) % images.length}>{$i18n.text("Предыдущая часть QR")}</button>{/if}
          <span>{$i18n("m_54ba0c65b828", {v0: (part + 1), v1: (images.length)})}</span>
          {#if images.length > 1}<button type="button" onclick={() => part = (part + 1) % images.length}>{$i18n.text("Следующая часть QR")}</button>{/if}
        </div>
        {#if singleImage}<button type="button" onclick={() => displayMode = 'single'}>{$i18n.text("Показать одним QR")}</button>{/if}
      {/if}
      <p>{$i18n("m_bf665b6936a0", {v0: (Math.max(0, Math.ceil((expires - now) / 1000)))})}</p>
      <button type="button" onclick={finishShowing}>{output.kind === 'offer' ? $i18n.text("Закончить показ и сканировать ответ") : $i18n.text("Я показала ответ — ждать соединения")}</button>
      <button type="button" onclick={copy}>{copied ? $i18n.text("Код скопирован") : $i18n.text("Копировать код подключения")}</button>
      <details><summary>{$i18n.text("Показать полный код подключения")}</summary><textarea readonly value={encoded} rows="3" aria-label={$i18n.text("Ваш код прямого подключения")}></textarea></details>
    {:else if qrExpired}
      <p>{output.kind === 'offer' ? $i18n("m_e69f7e8349ee", {v0: (Math.max(0, Math.ceil((expires + DIRECT_LIFETIME_MS - now) / 1000)))}) : $i18n.text("Время показа ответа закончилось. Создайте новую попытку.")}</p>
    {:else}
      <p>{output.kind === 'offer' ? $i18n.text("Показ завершён. Сканируйте ответ собеседника.") : $i18n.text("Ответ показан. Ожидаем, когда первый пользователь его считает.")}</p>
      <button type="button" onclick={() => { scanning = false; showingOutput = true; }}>{$i18n.text("Показать мой QR снова")}</button>
    {/if}
  {/if}
  {#if peer}<p role="status">{connected ? $i18n.text("Прямое защищённое соединение установлено") : expired ? $i18n.text("Попытка истекла. Повторите обмен QR.") : failed ? $i18n.text("Не удалось открыть прямой канал. Проверьте Wi-Fi/WebRTC и повторите обмен QR.") : $i18n.text("Ожидаем завершения обмена и защищённого соединения…")}</p>{/if}
  {#if expired && !peer}<p role="status">{$i18n.text("Предложение истекло. Создайте новое.")}</p>{/if}
  {#if connected}<button type="button" onclick={() => openChat(peer)}>{$i18n.text("Открыть чат")}</button>{/if}
  {#if output || preview || busy}<button type="button" onclick={reset}>{failed ? $i18n.text("Сбросить попытку") : $i18n.text("Убрать QR / отменить попытку")}</button>{/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
</div>

<style>
  .direct-pairing { overflow-wrap:anywhere; }
  .actions { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:8px 0; }
  textarea { display:block; width:100%; max-width:600px; box-sizing:border-box; margin:8px 0; }
  img { max-width:100%; height:auto; }
  details { margin:10px 0; }
  .confirmation { border:1px solid var(--line); padding:10px; margin:10px 0; }
  .confirmation code { display:block; }
</style>
