<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import QRCode from 'qrcode';
  import { WebCryptoIdentity } from '$lib/identity/webcrypto';
  import { SerialRadio, type RadioSnapshot, type RadioDiagnostics } from '$lib/radio/serial-radio';
  import { networkInvite, networkId, encodeNetworkInvite, parseNetworkInvite, matchingChannel } from '$lib/radio/network';
  import { RadioCrypto, encodeRadioContact, parseRadioContact, MAX_RADIO_TEXT_BYTES } from '$lib/radio/crypto';
  import { RadioConversation, type RadioMessage } from '$lib/radio/conversation';
  import { readQrImage } from '$lib/transport/qr-reader';
  let snapshot = $state.raw<RadioSnapshot | null>(null), selected = $state(0), busy = $state(false), supported = $state(false);
  let own = $state(''), ownQr = $state(''), network = $state(''), networkQr = $state(''), networkVisible = $state(false);
  let peerInput = $state(''), networkInput = $state(''), error = $state(''), notice = $state(''), draft = $state(''), fingerprint = $state('');
  let connected = $state(false), peerAddress = $state(''), messages = $state<RadioMessage[]>([]);
  const textBytes = $derived(new TextEncoder().encode(draft).length);
  const selectedChannel = $derived(snapshot?.channels.find(channel => channel.index === selected));
  const signer = new WebCryptoIdentity(), radio = new SerialRadio();
  let diagnostics = $state.raw<RadioDiagnostics | null>(null);
  const nodeLabel = (node: number) => `!${node.toString(16).padStart(8, '0')}`;
  let session: RadioCrypto | null = null, conversation: RadioConversation | null = null, generation = 0, alive = true;
  const statuses = { queued: 'В очереди', transmitting: 'Передаём радиомодулю', awaiting: 'Ждём ответа платы', board: 'Принято платой собеседника', received: 'Принято стендом собеседника', retry: 'Подтверждение не получено', stopped: 'Остановлено' };
  function describe(value: unknown) {
    const code = value instanceof Error ? value.message : String(value);
    const descriptions: Record<string, string> = {
      radio_serial_unsupported: 'Этот браузер не предоставляет Web Serial. Откройте стенд в совместимом браузере на компьютере.',
      radio_config_timeout: 'Meshtastic не ответила на запрос конфигурации. Проверьте прошивку, USB-кабель и закрытие других клиентов порта.',
      radio_custom_modem_unsupported: 'Первый стенд поддерживает штатный preset без ручной частоты, смещения и отключения ограничений эфира. Настройки платы не менялись.',
      radio_transmit_disabled: 'На плате выключена передача. Настройки платы не менялись.',
      radio_incomplete_config: 'Не получены номер устройства, активный канал или регион. Сначала настройте Meshtastic на плате.',
      radio_invalid_contact: 'Не удалось прочитать радиоконтакт. Скопируйте целиком «Мой радиоконтакт», начиная с mesh-radio-contact1:. Приглашение в радиосеть сюда не подходит.',
      radio_contact_network_mismatch: 'Радиосети не совпадают. Сверьте регион, preset, частотный слот, имя и ключ выбранного канала. Автоматический слот и заданный номер пока сравниваются строго. Затем обменяйтесь свежими радиоконтактами.',
      radio_contact_from_future: 'Приглашение создано с временем из будущего. Проверьте часы на обоих компьютерах.',
      radio_contact_expired: 'Срок радиоконтакта истёк. Переподключите USB и обменяйтесь новыми приглашениями.',
      invalid_offline_signature: 'Подпись радиоконтакта не прошла проверку. Скопируйте свежее приглашение целиком.',
      radio_device_queue_rejected: 'Радиомодуль отклонил постановку в очередь. Подождите и повторите сообщение вручную.',
      radio_route_6: 'Meshtastic не нашла подходящий активный канал для отправки.',
      radio_route_7: 'Meshtastic отклонила пакет: превышен допустимый размер.',
      radio_route_9: 'Meshtastic отложила отправку из-за ограничения эфирного времени.',
      radio_route_34: 'Meshtastic не смогла зашифровать личный пакет ключами плат (PKI).',
      radio_route_35: 'У принимающей платы нет публичного ключа отправителя. Проверьте знакомство плат через Meshtastic.',
      radio_route_38: 'Meshtastic ограничила частоту отправок. Подождите перед ручным повтором.',
      radio_route_39: 'У отправляющей платы нет публичного ключа получателя. Проверьте знакомство плат через Meshtastic.',
      radio_queue_confirmation_timeout: 'Радиомодуль не подтвердил приём пакета. Это не подтверждение доставки собеседнику.',
      radio_usb_disconnected: 'USB отключён. Переподключите модуль и обменяйтесь новыми приглашениями.',
      radio_invalid_signature: 'Подпись сообщения не прошла проверку. Сообщение не принято.',
      radio_wrong_or_expired_peer: 'Приглашение собеседника просрочено или относится к этому же устройству.',
      radio_outbox_limit: 'Очередь стенда заполнена. Дождитесь подтверждений или завершите сеанс.',
    };
    return descriptions[code] ?? (code === 'NotFoundError' || code.includes('No port selected') ? 'USB-порт не выбран.' : `Операция не завершена: ${code}`);
  }
  function stopConversation() { conversation?.close(); conversation = null; session?.dispose(); session = null; connected = false; peerAddress = ''; }
  async function setupChannel() {
    const token = ++generation; stopConversation(); own = ''; ownQr = ''; network = ''; networkQr = ''; networkVisible = false; messages = [];
    if (!snapshot || !selectedChannel) return;
    const invite = networkInvite(snapshot.profile, selectedChannel); const id = await networkId(invite);
    const next = await RadioCrypto.create(signer, id, snapshot.node);
    if (!alive || token !== generation) { next.dispose(); return; }
    session = next; fingerprint = id; own = encodeRadioContact(next.contact); network = encodeNetworkInvite(invite);
    const image = await QRCode.toDataURL(own, { width: 540, margin: 3, errorCorrectionLevel: 'M' });
    if (alive && token === generation) ownQr = image;
  }
  onMount(() => { supported = SerialRadio.supported(); });
  onDestroy(() => { alive = false; generation++; stopConversation(); void radio.close(); signer.dispose(); });
  radio.onPacket = packet => conversation?.receive(packet);
  radio.onDiagnostics = value => { if (alive) diagnostics = value; };
  radio.onError = code => { if (alive) { error = describe(Error(code)); if (['radio_usb_disconnected', 'radio_device_restarted', 'radio_serial_error'].includes(code)) stopConversation(); } };
  async function connectUsb() {
    busy = true; error = ''; notice = ''; ++generation; stopConversation();
    try {
      // requestPort is reached before any asynchronous crypto to retain the user gesture.
      const opening = radio.selectAndOpen(); await signer.create();
      const value = await opening;
      if (!alive) { await radio.close(); return; }
      snapshot = value; selected = value.channels[0]?.index ?? 0; await setupChannel();
      notice = 'Конфигурация прочитана. Частота, ключи каналов и параметры платы не изменялись.';
    } catch (value) { error = describe(value); snapshot = null; await radio.close(); }
    finally { if (alive) busy = false; }
  }
  async function disconnectUsb() { ++generation; stopConversation(); snapshot = null; own = ''; ownQr = ''; network = ''; networkQr = ''; networkVisible = false; await radio.close(); }
  async function showNetwork() {
    if (networkVisible) { networkVisible = false; networkQr = ''; return; }
    const value = network, token = generation; const image = await QRCode.toDataURL(value, { width: 360, margin: 3 });
    if (alive && token === generation) { networkQr = image; networkVisible = true; }
  }
  async function compareNetwork() {
    error = ''; notice = '';
    try {
      if (!snapshot) return;
      const channel = await matchingChannel(parseNetworkInvite(networkInput.trim()), snapshot.profile, snapshot.channels);
      if (!channel) { notice = 'Параметры не совпадают. Приглашение не меняет плату автоматически: настройте радиосеть через Meshtastic и подключите USB заново.'; return; }
      if (channel.index !== selected) { selected = channel.index; await setupChannel(); }
      notice = `Радиосеть совпадает. На этой плате используется локальный канал ${channel.index}.`;
    } catch (value) { error = describe(value); }
  }
  async function acceptPeer() {
    error = ''; notice = ''; const token = generation;
    try {
      if (!session || !snapshot) throw Error('radio_not_ready');
      const peer = await parseRadioContact(peerInput.trim(), fingerprint);
      if (!alive || token !== generation) return;
      if (peer.body.node === snapshot.node || peer.body.account === session.contact.body.account) throw Error('radio_wrong_or_expired_peer');
      conversation?.close(); conversation = new RadioConversation(session, peer, radio, selected);
      conversation.onMessage = message => { if (alive && token === generation) messages = [...messages, message]; };
      conversation.onUpdate = message => {
        if (!alive || token !== generation) return;
        const index = messages.findIndex(item => item.id === message.id);
        messages = index < 0 ? [...messages, message] : messages.map(item => item.id === message.id ? message : item);
      };
      conversation.onError = code => { if (alive && token === generation) error = describe(Error(code)); };
      connected = true; peerAddress = peer.body.account;
      notice = 'Подпись приглашения проверена. На втором компьютере тоже добавьте ваш QR. Это настройка маршрута, ещё не проверка радиодоступности.';
    } catch (value) { error = describe(value); }
  }
  async function send() {
    if (!conversation || !draft.trim() || textBytes > MAX_RADIO_TEXT_BYTES) return;
    const value = draft; error = '';
    try { await conversation.send(value); if (draft === value) draft = ''; } catch (failure) { error = describe(failure); }
  }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); notice = 'Скопировано.'; } catch { notice = 'Выделите и скопируйте текст приглашения вручную.'; } }
  async function readImage(event: Event, target: 'peer' | 'network') {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return;
    try { const value = await readQrImage(file); if (target === 'peer') peerInput = value; else networkInput = value; } catch (value) { error = describe(value); }
  }
</script>
<svelte:head><title>LoRa · локальный USB-стенд Automesh</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<main class="radio-lab">
  <header><h1>LoRa · первый USB-стенд</h1><p>Два Heltec V4 с Meshtastic. Для первого теста достаточно одного компьютера и двух вкладок. Без серверов и сигналинга.</p></header>
  <aside>Временные аккаунты и сообщения хранятся только в памяти этого стенда. Обновление страницы создаёт новый аккаунт и ключ. Настоящие чаты и сид не используются. Приём радиомодулем и приём приложением показаны раздельно. Общий канал проверен пользователем на двух Heltec V4 без интернета; вторичный канал проверяем отдельно.</aside>
  <section><h2>1. Радиомодуль</h2>
    <p>На обеих платах заранее настройте Meshtastic: совместимые регион, preset, частоту и канал. Закройте другой клиент USB-порта.</p>
    <details><summary>USB-порт виден, но плата не отвечает</summary><p>Через Android/Bluetooth проверьте «Безопасность → Serial Console»: консоль должна быть включена. Сохраните настройку и перезапустите плату. Одним COM-портом одновременно пользуется только один клиент.</p></details>
    <div class="actions"><button disabled={busy || !supported} onclick={connectUsb}>{busy ? 'Читаем конфигурацию…' : 'Подключить USB и прочитать настройки'}</button>{#if snapshot}<button onclick={disconnectUsb} disabled={busy}>Отключить</button>{/if}</div>
    {#if !supported}<p>Нужен браузер с Web Serial на компьютере. Автоматического доступа к USB нет.</p>{/if}
    {#if snapshot}
      <p>Устройство <code>!{snapshot.node.toString(16).padStart(8, '0')}</code> · Meshtastic {snapshot.firmware || 'версия не сообщена'}</p>
      <p>Регион {snapshot.profile.region} · preset {snapshot.profile.preset} · слот {snapshot.profile.slot || 'автоматический'} · primary «{snapshot.profile.primary || 'по умолчанию'}»</p>
      <label>Канал на этой плате<select bind:value={selected} disabled={busy || connected} onchange={() => { void setupChannel().catch(value => error = describe(value)); }}>{#each snapshot.channels as channel}<option value={channel.index}>{channel.index} · {channel.name || 'по умолчанию'}</option>{/each}</select></label>
      {#if fingerprint}<p>Отпечаток радиосети: <code>{fingerprint.slice(0, 16)}</code>. На обеих вкладках должен совпадать.</p>{/if}
      {#if selectedChannel?.uplink || selectedChannel?.downlink}<p class="warning">На этом канале разрешён MQTT в конфигурации платы. Стенд не публикует MQTT и не принимает пришедшее через MQTT. Для чистого радиоиспытания отключите интернет-шлюзы в Meshtastic.</p>{/if}
      <details><summary>Как шифруется личная радиопередача</summary><p>Automesh шифрует и подписывает сообщение до передачи плате. Meshtastic может дополнительно использовать личные ключи плат (PKI): тогда входящий пакет отмечен каналом 0, даже если здесь выбран MyDevices. Это не означает отправку текста в общий чат. Использование общего ключа MyDevices для каждого личного пакета не гарантируется прошивкой.</p></details>
      {#if diagnostics}<details><summary>Диагностика радио</summary>
        <p>Принято модулем в очередь: {diagnostics.queued} · отказов очереди: {diagnostics.queueErrors}.</p>
        <p>Mesh-пакетов из USB: {diagnostics.incoming} · Automesh: {diagnostics.application} · из них PKI: {diagnostics.pki}.</p>
        <p>Без расшифрованных данных: {diagnostics.undecoded} · пропущено MQTT: {diagnostics.mqttSkipped} · ошибок формата: {diagnostics.parseErrors} · ошибок маршрута: {diagnostics.routeErrors}.</p>
        {#if diagnostics.lastApplication}<p>Последний пакет Automesh: <code>{nodeLabel(diagnostics.lastApplication.from)} → {nodeLabel(diagnostics.lastApplication.to)}</code> · канал {diagnostics.lastApplication.channel} · {diagnostics.lastApplication.pkiEncrypted ? 'PKI' : 'ключ канала'}.</p>{/if}
        {#if diagnostics.lastRouteError !== null}<p>Последний код ошибки Meshtastic: {diagnostics.lastRouteError}.</p>{/if}
        <p>Это диагностика USB и радиомодуля. Доставка подтверждается только статусом «Принято стендом собеседника». Текст сообщений и ключи здесь не выводятся.</p>
      </details>{/if}
      <details><summary>Приглашение в радиосеть</summary>
        <p>Одна радиосеть подходит для нескольких личных чатов. Приглашение содержит общий ключ канала, но не ключи личной переписки. Передавайте его выбранным людям.</p>
        <button onclick={showNetwork} disabled={!network}>{networkVisible ? 'Скрыть доступ к радиосети' : 'Показать QR с общим ключом радиосети'}</button>
        {#if networkVisible}<img class="qr network-qr" src={networkQr} alt="QR доступа в радиосеть с общим ключом"/><textarea readonly value={network} aria-label="Приглашение в радиосеть с общим ключом"></textarea><button onclick={() => copy(network)}>Копировать доступ в радиосеть</button>{/if}
        <label>Проверить приглашение радиосети<textarea bind:value={networkInput} maxlength="1600" autocomplete="off" spellcheck="false"></textarea></label>
        <div class="actions"><label class="file">Из изображения<input type="file" accept="image/*" onchange={event => readImage(event, 'network')}/></label><button onclick={compareNetwork} disabled={!networkInput.trim() || connected}>Сравнить с этой платой</button></div>
        <p>Индекс канала локален: у одного он может быть 0, у другого 1. Проверяем содержимое и радиопараметры. Настройки приглашением не перезаписываются.</p>
      </details>
    {/if}
  </section>
  {#if snapshot && own}<section><h2>2. Обмен контактами Automesh</h2>
    <p>На каждом компьютере покажите свой QR и добавьте QR другого. Подпись связывает Mesh ID, адрес модуля и временный ключ приёма. Общего ключа радиоканала в этом QR нет.</p>
    <div class="pairing"><div><img class="qr" src={ownQr} alt="Мой подписанный радиоконтакт Automesh"/><details><summary>Текст моего приглашения</summary><textarea readonly value={own} aria-label="Мой радиоконтакт"></textarea><button onclick={() => copy(own)}>Копировать мой радиоконтакт</button></details></div>
      <div><label>Приглашение собеседника<textarea bind:value={peerInput} maxlength="2400" autocomplete="off" spellcheck="false"></textarea></label>
        <div class="actions"><label class="file">Из изображения<input type="file" accept="image/*" onchange={event => readImage(event, 'peer')}/></label><button onclick={acceptPeer} disabled={!peerInput.trim() || connected}>Проверить и добавить собеседника</button></div>
        <p>Приглашения действуют до 24 часов и только пока открыт создавший их стенд. После переподключения обменяйтесь новыми.</p>
        {#if connected}<p>Собеседник: <code>{peerAddress}</code></p>{/if}
      </div></div>
  </section>{/if}
  {#if connected}<section><h2>3. Короткие сообщения</h2><p>Передаём пакеты с паузой 10 секунд. Радиомодуль сохраняет свои ограничения эфира. Повторы — вручную, без бесконечной рассылки.</p>
    <div class="messages" aria-live="polite">{#each messages as message (message.id)}<article class:outgoing={message.outgoing}><strong>{message.outgoing ? 'Вы' : 'Собеседник'}</strong><p>{message.text}</p><small>{statuses[message.status]}{message.status === 'transmitting' ? ` · ${message.sent}/${message.total} пакетов` : ''}</small>{#if message.outgoing && message.status === 'retry'}<button onclick={() => conversation?.retry(message.id)}>Повторить тот же конверт</button>{/if}</article>{/each}</div>
    <form onsubmit={event => { event.preventDefault(); void send(); }}><label>Сообщение<textarea bind:value={draft} maxlength="320" onkeydown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); } }}></textarea></label><div class="actions"><small>{textBytes}/{MAX_RADIO_TEXT_BYTES} байт UTF-8</small><button disabled={!draft.trim() || textBytes > MAX_RADIO_TEXT_BYTES}>Отправить по LoRa</button></div></form>
  </section>{/if}
  {#if notice}<p role="status">{notice}</p>{/if}{#if error}<p role="alert">{error}</p>{/if}
</main>
<style>
  .radio-lab{max-width:1000px;margin:0 auto;color:var(--text);padding:12px}h1{font-size:26px}h2{font-size:19px}section,aside{border:1px solid var(--line);background:var(--surface);padding:18px;border-radius:16px;margin:16px 0}aside,p,small{line-height:1.55}aside{color:var(--muted)}.actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}button,.file{min-height:44px;padding:9px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:inherit;cursor:pointer}.file{display:inline-flex;align-items:center;position:relative}.file input{position:absolute;width:1px;height:1px;opacity:0}.file:focus-within{outline:2px solid var(--focus)}button:disabled{opacity:.5;cursor:default}label{display:block;margin:12px 0}textarea,select{display:block;width:100%;margin-top:6px;padding:10px;background:var(--surface);color:inherit;border:1px solid var(--line);border-radius:12px}textarea{min-height:85px;overflow-wrap:anywhere}.pairing{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px}.qr{display:block;max-width:100%;width:360px;background:white;border-radius:12px;margin:12px 0}.network-qr{width:280px}code{overflow-wrap:anywhere;font-size:12px}details{margin:15px 0}summary{cursor:pointer;font-weight:600}.messages{display:flex;flex-direction:column;gap:10px;max-height:450px;overflow:auto}article{border:1px solid var(--line);border-radius:12px;padding:12px;max-width:85%;white-space:pre-wrap;overflow-wrap:anywhere}article.outgoing{align-self:flex-end;background:var(--surface-soft)}article p{margin:8px 0}article small{display:block}article button{margin-top:8px}[role=alert],.warning{color:var(--danger)}[role=status]{color:var(--accent)}@media(max-width:650px){.pairing{grid-template-columns:1fr}.radio-lab{padding:0}section,aside{padding:14px}}
</style>
