<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount, untrack } from 'svelte';
  import QRCode from 'qrcode';
  import QrInput from '../application/QrInput.svelte';
  import HelpInfo from '../application/HelpInfo.svelte';
  import NodeScanner from '../transport/NodeScanner.svelte';
  import { readQrImage } from '../transport/qr-reader';
  import type { OwnerDeviceStore } from './owner-store';
  import type { SignedObject } from '../core/objects';
  import { deviceComparisonCode } from './enrollment';
  import { deviceLink, type PairingChannel } from './links';
  import { webCryptoEnvironment } from '../core/ports';
  import { isLocalHost } from '../transport/client-config';
  import { createPairingChannel, pairingRequest, encryptPairingPacket, decryptPairingPacket, verifyPairingRequest, verifyPairingComplete } from './pairing';
  let { store, publish, invitation, prepare, setupNode, internetAllowed = true, mode = 'direct', nodeUrl = '', connection = '', connecting = false, enrollmentPaused = false, transferContacts, transferHistory }: {
    store?: OwnerDeviceStore; publish(): Promise<SignedObject>; invitation?: (channel: PairingChannel) => Promise<SignedObject>;
    prepare(): Promise<void>; setupNode(text: string, code: string): Promise<void>; internetAllowed?: boolean; mode?: 'node' | 'direct'; nodeUrl?: string; connection?: string; connecting?: boolean; enrollmentPaused?: boolean; transferContacts?: () => Promise<void>; transferHistory?: (device: string, label: string) => void;
  } = $props();
  let items = $state<Awaited<ReturnType<OwnerDeviceStore['list']>>>([]), view = $state<'list' | 'connect'>('list');
  let step = $state<'node' | 'qr' | 'confirm' | 'publishing' | 'waiting' | 'done'>('node');
  let busy = $state(false), error = $state(''), notice = $state(''), qr = $state(''), link = $state(''), code = $state('');
  let checked = $state.raw<SignedObject | null>(null), invite = $state.raw<SignedObject | null>(null);
  let channel: PairingChannel | null = null, ownerToken = '', packetSeen = '', completionSeen = '', approvalPacket = '';
  let generation = 0, alive = true, timer: ReturnType<typeof setTimeout> | undefined, abort: AbortController | undefined;
  let nodeInput = $state(''), nodeCode = $state(''), scanner = $state(false), confirmed = $state(false), shareContacts = $state(true), revokeId = $state('');
  let expiresAt = $state(0), clock = $state(Date.now());
  const current = (token: number) => alive && token === generation;
  $effect(() => { const activeStore = store; if (activeStore) untrack(() => void refresh()); });
  async function refresh() { const active = store; try { const list = await active?.list() ?? []; if (alive && store === active) items = list; } catch { if (alive && store === active) error = 'Не удалось прочитать список. Он не сброшен; повторите проверку.'; } }
  function stop() { clearTimeout(timer); abort?.abort(); abort = undefined; }
  function clearPair() {
    stop(); generation++; const prior = channel, token = ownerToken;
    channel = null; ownerToken = ''; checked = null; invite = null; code = ''; qr = ''; link = ''; packetSeen = ''; completionSeen = ''; approvalPacket = ''; confirmed = false;
    if (prior && token) void pairingRequest(prior.origin, 'cancel', { id: prior.id }, token).catch(() => {});
  }
  async function start() {
    if (busy || connecting || enrollmentPaused) return; clearPair(); view = 'connect'; step = 'node'; error = ''; notice = ''; busy = true;
    const token = generation;
    try {
      if (!internetAllowed && !isLocalHost(location.hostname)) { error = 'В режиме «Только LAN» публичный сервис обмена не используется. Для автоматического QR-подключения откройте локальную HTTPS-копию приложения или осознанно включите интернет. Ручной полностью автономный обмен — отдельный сценарий, пока не реализован.'; return; }
      await prepare();
      if (!current(token)) return;
      if (!invitation) { nodeInput = nodeUrl; return; }
      const relay = await createPairingChannel(location.origin);
      if (!current(token)) { void pairingRequest(relay.channel.origin, 'cancel', { id: relay.channel.id }, relay.ownerToken).catch(() => {}); return; }
      channel = relay.channel; ownerToken = relay.ownerToken;
      const signed = await invitation(channel); if (!current(token)) return; invite = signed;
      const text = deviceLink({ kind: 'invite', value: signed }, location.origin);
      const image = await QRCode.toDataURL(text, { width: 768, margin: 4, errorCorrectionLevel: 'M' });
      if (!current(token)) return; link = text; qr = image; expiresAt = signed.record.expiresAt!; clock = Date.now(); step = 'qr'; schedule();
    } catch { if (current(token)) error = 'Не удалось открыть подключение. Проверьте связь и повторите. QR ещё не создан, права не выданы.'; }
    finally { if (current(token)) busy = false; }
  }
  function schedule() { clearTimeout(timer); if (alive && channel && step !== 'done' && !document.hidden) timer = setTimeout(() => void poll(), 1500); }
  async function poll() {
    if (!channel || !invite || document.hidden) return;
    if (Date.now() >= expiresAt) { stop(); error = 'Время подключения истекло. Создайте новый QR; уже выданные разрешения не отзываются автоматически.'; return; }
    const pairing = channel, signed = invite, token = generation, controller = new AbortController(); abort = controller;
    try {
      const response = await pairingRequest(pairing.origin, 'read', { id: pairing.id }, ownerToken, controller.signal);
      if (!current(token)) return;
      if (response.request && !checked && response.request !== packetSeen) {
        const value = await decryptPairingPacket(pairing, 'request', response.request);
        const request = await verifyPairingRequest(value, signed);
        const comparison = await deviceComparisonCode(signed.record.author, request, webCryptoEnvironment());
        if (!current(token)) return; checked = request; code = comparison; packetSeen = response.request; confirmed = false; step = 'confirm'; error = '';
      }
      if (response.complete && checked && response.complete !== completionSeen && step === 'waiting') {
        await verifyPairingComplete(await decryptPairingPacket(pairing, 'complete', response.complete), signed, checked);
        if (!current(token)) return; completionSeen = response.complete;
        notice = 'Устройство проверило права и подготовило получение сообщений.';
        if (shareContacts && transferContacts) { try { await transferContacts(); } catch { if (current(token)) notice += ' Контакты пока не переданы; повторите передачу из списка устройств.'; } }
        if (!current(token)) return; step = 'done'; await refresh();
      }
    } catch (failure) { if (current(token) && !controller.signal.aborted) error = failure instanceof Error && failure.message === 'device_pair_expired' ? 'Окно подключения закрыто или истекло. Создайте новый QR.' : 'Не удалось получить ответ. Повторяем автоматически; ничего вводить или сканировать обратно не нужно.'; }
    finally { if (current(token)) { abort = undefined; schedule(); } }
  }
  async function approve() {
    if (!checked || !store || !confirmed || busy || Date.now() >= expiresAt) return;
    const request = checked, token = generation; busy = true; step = 'publishing'; error = '';
    try {
      if (!channel || !invite) throw new Error('device_pair_closed');
      if (!approvalPacket) {
        const certificate = await store.approve(request, { approved: true, comparisonCode: code });
        if (!current(token)) return;
        const membership = await publish(); if (!current(token)) return;
        approvalPacket = await encryptPairingPacket(channel, 'approval', { invitation: invite.record.id,
          approval: { type: 'automesh-device-approval-prototype-v1', certificate, membership } });
      }
      await pairingRequest(channel.origin, 'approve', { id: channel.id, packet: approvalPacket }, ownerToken);
      if (!current(token)) return; step = 'waiting';
      notice = mode === 'node' ? 'Нода подтвердила сохранение разрешения. Второе устройство получает его автоматически.' : 'Владелец подписал разрешение. Второе устройство получает его по зашифрованному каналу.'; await refresh();
    } catch { if (current(token)) { step = 'confirm'; error = 'Передача разрешения не подтверждена. Нажмите «Повторить подтверждение». Сверка, заявка и уже сохранённое разрешение остаются здесь.'; } }
    finally { if (current(token)) busy = false; }
  }
  async function connectNode() {
    if (busy || connecting) return; busy = true; error = ''; const token = generation;
    try { await setupNode(nodeInput, nodeCode); if (!current(token)) return; nodeCode = ''; view = 'list'; notice = 'Нода добавлена. Уже подключённое устройство получит подписанное обновление маршрута при связи с владельцем.'; await refresh(); }
    catch { if (current(token)) error = 'Нода не подключена. Проверьте приглашение и код привязки из панели ноды. Старые привязки не заменены.'; }
    finally { if (current(token)) busy = false; }
  }
  async function image(event: Event) {
    const input = event.target as HTMLInputElement, file = input.files?.[0]; input.value = ''; if (!file) return;
    try { const value = await readQrImage(file); if (alive) nodeInput = value; } catch { if (alive) error = 'QR не найден. Можно вставить приглашение ноды текстом.'; }
  }
  async function copy() { try { await navigator.clipboard.writeText(link); notice = 'Ссылка скопирована. Откройте её только на своём втором устройстве.'; } catch { error = 'Выделите ссылку и скопируйте вручную.'; } }
  async function revoke() {
    if (!store || busy) return; busy = true; error = '';
    try { await store.revoke(revokeId, true); await publish(); revokeId = ''; notice = mode === 'node' ? 'Нода подтвердила отзыв. Уже сохранённые устройством данные удалить удалённо нельзя.' : 'Владелец сохранил отзыв. Следующая свежая проверка запретит доступ; уже сохранённые устройством данные удалить удалённо нельзя.'; await refresh(); }
    catch { error = 'Публикация отзыва не подтверждена. Локальный запрет мог сохраниться; повторите действие.'; } finally { if (alive) busy = false; }
  }
  async function renew(id: string) {
    if (!store || busy) return; busy = true; error = '';
    try { await store.renew(id, true); await publish(); await refresh(); notice = 'Доступ продлён на 30 дней.'; }
    catch { error = 'Продление не подтверждено. Повторите действие.'; } finally { if (alive) busy = false; }
  }
  onMount(() => {
    void refresh(); const interval = setInterval(() => clock = Date.now(), 1000);
    const visibility = () => document.hidden ? stop() : schedule(); document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visibility); clearPair(); alive = false; };
  });
</script>
<section class="devices" aria-label={$i18n.text("Устройства аккаунта")}>
  <h4>{$i18n.text("Устройства аккаунта")}</h4>
  {#if view === 'list'}
    {#if enrollmentPaused}<p role="status">{$i18n.text("Подключение устройств и синхронизация новых сообщений приостановлены. Список устройств, права и очереди сохранены.")}</p>
    {:else}<p>{$i18n.text("Подключите телефон или компьютер по QR без передачи сида.")}</p>{/if}
    <button type="button" class="primary" disabled={busy || connecting || enrollmentPaused} onclick={start}>{$i18n.text("Подключить новое устройство")}</button>
    <button type="button" disabled={busy} onclick={() => void refresh()}>{$i18n.text("Обновить список устройств")}</button>
    <p class="help-text">{mode === 'node' ? $i18n.text("Доставка через ноду · первое устройство можно выключить.") : $i18n.text("Прямой режим · без ноды. Для проверки прав нужен доступный владелец; отложенной доставки нет.")}</p>
    <button type="button" disabled={busy || connecting} onclick={() => { clearPair(); view = 'connect'; step = 'node'; nodeInput = nodeUrl; }}>{$i18n.text("Добавить ноду для доставки")}</button>
    {#if !enrollmentPaused}<p class="help-text">{$i18n.text("Синхронизируются новые текстовые сообщения. Новые файлы и звонки доступны только на основном устройстве.")} <HelpInfo label={$i18n.text("Справка: возможности подключённых устройств")} text={$i18n.text("Сид остаётся у владельца. Каждое подключённое устройство получает отдельный ключ и ограниченные права на текстовые чаты. История и сохранённые вложения переносятся отдельно из списка устройств. Добавлять устройства, продлевать и отзывать их доступ может владелец.")} /></p>{/if}
    <h4>{$i18n.text("Подключённые устройства")}</h4>
    {#if !items.length}<p>{$i18n.text("Других устройств пока нет.")}</p>{/if}
    {#each items as item (item.id)}<div class="device-row" data-device={item.device}><div><strong>{item.label}</strong><small>{$i18n("m_ff247eea79c8", {v0: (item.status === 'revoked' ? $i18n.text("Доступ отозван") : item.status === 'expired' ? $i18n.text("Доступ истёк") : $i18n.text("Разрешены текстовые чаты")), v1: (new Date(item.expiresAt).toLocaleDateString($uiLocale))})}</small></div>
      {#if item.status === 'authorized' && transferHistory}<button type="button" disabled={busy || connecting} aria-label={$i18n("m_83c9aab9ad1f", {v0: (item.label)})} onclick={() => transferHistory?.(item.device, item.label)}>{$i18n.text("Перенести историю и вложения")}</button>{/if}
      {#if item.status !== 'revoked'}<button disabled={busy} onclick={() => void renew(item.id)}>{$i18n.text("Продлить")}</button><button disabled={busy} aria-label={$i18n("m_a212077acc0d", {v0: (item.label)})} onclick={() => revokeId = item.id}>{$i18n.text("Отозвать доступ")}</button>{/if}</div>{/each}
    {#if revokeId}<div class="card"><p>{$i18n.text("Запретить этому устройству новые сообщения?")}</p><button disabled={busy} onclick={revoke}>{$i18n.text("Да, отозвать доступ")}</button><button disabled={busy} onclick={() => revokeId = ''}>{$i18n.text("Отмена")}</button></div>{/if}
    {#if transferContacts}<button disabled={busy} onclick={async () => { busy = true; try { await transferContacts?.(); notice = 'Профиль и контакты поставлены в зашифрованную очередь.'; } catch { error = 'Передача пока не завершена.'; } finally { busy = false; } }}>{$i18n.text("Передать профиль и контакты")}</button>{/if}
  {:else}
    <div class="card" aria-label={$i18n.text("Подключить новое устройство")}>
      <h3>{$i18n.text("Подключить новое устройство")}</h3>
      {#if busy && step === 'node'}<p role="status">{$i18n.text("Проверяем готовность подключения…")}</p>
      {:else if step === 'node'}
        <h4>{$i18n.text("Добавить ноду для доставки")}</h4>
        <p>{$i18n.text("Нода необязательна для выдачи прав. Она добавляет очередь и проверку доступа, когда первое устройство выключено. Сид и ключ подключённого устройства не меняются.")}</p>
        <p role="status">{$i18n.text(connection)}</p>
        {#if nodeUrl}<button disabled={busy || connecting} onclick={start}>{$i18n.text("Повторить проверку и показать QR")}</button>{/if}
        <QrInput bind:value={nodeInput} label={$i18n.text("Приглашение или адрес ноды")} onScan={() => scanner = true} onImage={image} disabled={busy} maxlength={4096} />
        <label>{$i18n.text("Код привязки, если его нет в приглашении")}<input bind:value={nodeCode} maxlength="48" autocomplete="off" /></label>
        <p class="help-text">{$i18n.text("Возьмите приглашение и код в панели своей или предоставленной вам ноды. Это не QR подключения второго устройства.")}</p>
        <button disabled={busy || connecting || !nodeInput.trim()} onclick={connectNode}>{$i18n.text("Подключить ноду")}</button>
        <button disabled={busy || connecting} onclick={start}>{$i18n.text("Продолжить без ноды")}</button>
      {:else}
        <p class="step">{step === 'qr' ? $i18n.text("1 · Отсканируйте на втором устройстве") : step === 'confirm' ? $i18n.text("2 · Сравните код и разрешите вход") : step === 'done' ? $i18n.text("Готово") : $i18n.text("3 · Завершаем подключение")}</p>
        <p class="help-text">{mode === 'node' ? $i18n.text("Через подключённую ноду. Первое устройство после подключения можно выключить.") : $i18n.text("Без ноды. Права проверяются у открытого владельца; сообщения идут напрямую, очереди на сервере нет.")}</p>
        {#if step === 'qr'}<p>{$i18n.text("На втором устройстве нажмите «Войти без сида» и отсканируйте этот QR. Это окно оставьте открытым.")}</p>
          <img src={qr} alt={$i18n.text("QR подключения нового устройства")} /><label>{$i18n.text("Ссылка подключения")}<input readonly value={link} /></label><button onclick={copy}>{$i18n.text("Скопировать ссылку")}</button>
          <p class="help-text">{$i18n.text("QR действует 10 минут. Показывайте только своему устройству: он открывает зашифрованный канал заявки, но сам по себе не даёт права входа.")}</p>
          <p role="status">{$i18n.text("Ожидаем второе устройство… Обратный QR не нужен.")}</p>
        {/if}
        {#if checked}<h4>{(checked.record.body as Record<string, string>).label}</h4><strong class="code" aria-label={$i18n.text("Код сверки")}>{code}</strong>
          <p>{$i18n.text("На втором устройстве должен быть такой же код. Не подтверждайте чужое устройство.")}</p>
          {#if step === 'confirm'}<label class="check"><input type="checkbox" bind:checked={confirmed} /> {$i18n.text("Код совпадает на обоих устройствах")}</label>
            <label class="check"><input type="checkbox" bind:checked={shareContacts} /> {$i18n.text("Передать название профиля и контакты")}</label>
        <button class="primary" disabled={!confirmed || busy || clock >= expiresAt} onclick={approve}>{$i18n.text(error) ? $i18n.text("Повторить подтверждение") : $i18n.text("Разрешить вход")}</button>
          {:else if step === 'publishing'}<p role="status">{$i18n.text("Подписываем и передаём разрешение…")}</p>
          {:else if step === 'waiting'}<p role="status">{$i18n.text("Разрешение сохранено. Второе устройство проверяет его и открывает чаты. Не закрывайте это окно.")}</p>
          {:else if step === 'done'}<p role="status">{mode === 'node' ? $i18n.text("Устройство подключено. Первое устройство теперь можно выключить.") : $i18n.text("Устройство подключено без ноды. Для прямого общения и проверки прав оставьте владельца доступным.")}</p>{/if}
        {/if}
        {#if step !== 'done'}<small>{clock < expiresAt ? $i18n("m_c76e8881ce6e", {v0: (Math.max(0, Math.ceil((expiresAt-clock)/60000)))}) : $i18n.text("Время QR истекло.")}</small>{/if}
      {/if}
      {#if step === 'done'}<button onclick={() => { clearPair(); view = 'list'; error = ''; notice = ''; }}>{$i18n.text("К списку устройств")}</button>
      {:else}<button disabled={busy || step === 'publishing'} onclick={() => { clearPair(); view = 'list'; error = ''; notice = ''; }}>{$i18n.text("Закрыть подключение")}</button>{/if}
      {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}{#if notice}<p role="status">{$i18n.text(notice)}</p>{/if}
    </div>
  {/if}
  {#if view === 'list' && error}<p role="alert">{$i18n.text(error)}</p>{/if}{#if view === 'list' && notice}<p role="status">{$i18n.text(notice)}</p>{/if}
  {#if scanner}<NodeScanner label={$i18n.text("Приглашение ноды")} onClose={() => scanner = false} onResult={value => { nodeInput = value; scanner = false; }} />{/if}
</section>
<style>
  .card{padding:16px;border:1px solid var(--line);border-radius:18px;margin-top:12px}.primary{background:var(--accent);color:var(--on-accent)}button{min-height:44px;margin:4px 8px 4px 0}label{display:block;margin:12px 0}input{width:100%;box-sizing:border-box}.code{display:block;font-size:clamp(20px,5vw,28px);letter-spacing:2px;overflow-wrap:anywhere;margin:16px 0}.check{display:flex;align-items:center;gap:10px}.check input{width:22px;height:22px;flex-shrink:0}.device-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:12px 0;border-bottom:1px solid var(--line)}.device-row>div{flex:1;min-width:140px}small{display:block;color:var(--muted)}img{width:min(100%,360px);height:auto;image-rendering:pixelated}.step{color:var(--muted);font-size:14px}
</style>
