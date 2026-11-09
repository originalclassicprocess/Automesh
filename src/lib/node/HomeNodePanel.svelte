<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onDestroy, untrack } from 'svelte';
  import type { IdentityProvider } from '$lib/identity/identity';
  import { inspectHomeNode, signedNodeRequest, homeNodeUrl, requireNodeNetwork, type NodeInfo } from './client';
  import type { NodeAddress } from './offline-crypto';
  import type { CourierState } from './courier-state';
  import type { CourierStatus } from './courier-controller';
  import { isValidAccountId } from '$lib/addressing/bech32m.js';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import QrInput from '$lib/application/QrInput.svelte';
  import NodeScanner from '$lib/transport/NodeScanner.svelte';
  import { readQrImage } from '$lib/transport/qr-reader';
  import { parseNodeSetup } from './pair-invite';
  import { FILE_POLICY_BYTES } from './attachment-protocol.js';
  import NodeDownloads from './NodeDownloads.svelte';
  import NodeQuotaDetails from './NodeQuotaDetails.svelte';
  let { address, signer, addSignaling, trusted, offlineNode, offlineEnabled, offlineError, pendingCount, configureOffline, courierState, courierError, configureCourier,
    mode, courierStatus, waitingCount, receivingReady, receiveKeys, internetEnabled = true, setupOnly = false, legacyOnly = false }:
    { address: string; signer: () => IdentityProvider | null; addSignaling: (url: string) => Promise<void>;
      trusted: boolean; offlineNode: NodeAddress | null; offlineEnabled: boolean; offlineError: string; pendingCount: number;
      configureOffline: (node: NodeAddress, enabled: boolean) => Promise<void>; courierState: CourierState; courierError: string;
      configureCourier: (node: NonNullable<CourierState['node']>, enabled: boolean) => Promise<void>;
      mode: 'outgoing' | 'incoming'; courierStatus: CourierStatus; waitingCount: number; receivingReady: boolean; receiveKeys: number; internetEnabled?: boolean; setupOnly?: boolean; legacyOnly?:boolean } = $props();
  let url = $state(untrack(() => mode === 'outgoing' ? courierState.node?.url ?? offlineNode?.url ?? '' : offlineNode?.url ?? ''));
  let legacySetup = $state(untrack(() => legacyOnly));
  let code = $state(''); let info = $state<NodeInfo | null>(null);
  let error = $state(''); let result = $state(''); let busy = $state(false);
  let controller: AbortController | null = null; let alive = true;
  let sender = $state(''); let queueStatus = $state<{ messages: number; bytes: number; maxBytes: number; senders: string[] } | null>(null);
  let scanner = $state(false); let scannedNodeId = $state('');
  function acceptPairQr(text: string) {
    if (busy || !alive) return;
    scanner = false; info = null; queueStatus = null; error = ''; result = ''; code = ''; scannedNodeId = '';
    try {
      const invite = parseNodeSetup(text); url = invite.url; code = invite.code; scannedNodeId = invite.nodeId;
      result = code ? 'QR привязки считан. Проверьте узел и подключите профиль. Доверие к сертификату требуется отдельно.'
        : 'Адрес ноды считан. Для нового профиля возьмите код или QR привязки; QR сигналинга не даёт доступ к очереди.';
    } catch { error = 'QR ноды неверен или истёк. Используйте QR сигналинга или новый QR привязки из окна ноды.'; }
  }
  async function readPairFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement, file = input.files?.[0];
    try { if (file) { const value = await readQrImage(file); if (alive) acceptPairQr(value); } }
    catch { if (alive) error = 'Не удалось прочитать QR из изображения.'; }
    finally { input.value = ''; }
  }
  onDestroy(() => { alive = false; controller?.abort(); code = ''; });
  async function work(action: (signal: AbortSignal) => Promise<void>) {
    if (busy) return; busy = true; scanner = false; error = ''; result = ''; controller = new AbortController();
    const timer = setTimeout(() => controller?.abort(), 15_000);
    try { await action(controller.signal); }
    catch (failure) { if (alive) {
      if (failure instanceof Error && failure.message === 'internet_disabled') error = 'Включите «Интернет + LAN» для подключения серверной ноды.';
      else if (failure instanceof Error && failure.message === 'not_published') error = 'Установщик ещё не опубликован для этой сборки приложения.';
      else if (failure instanceof Error && failure.message === 'invalid_node_url') error = 'Укажите полный HTTPS-адрес домашнего узла без дополнительных путей, например https://192.168.1.10:3003/.';
      else if (failure instanceof Error && failure.message === 'invalid_pair_code') error = 'Код привязки неверен или истёк. Возьмите действующий код из окна узла.';
      else if (failure instanceof Error && failure.message === 'node_identity_changed') error = 'ID узла не совпадает с QR. Привязка остановлена: проверьте адрес и создайте QR на своей ноде заново.';
      else if (failure instanceof Error && failure.message === 'offline_requires_trusted') error = 'Офлайн-доставка требует доверенного режима и доступного зашифрованного хранилища.';
      else if (failure instanceof Error && failure.message === 'offline_node_change_pending') error = 'В старом узле ещё есть действующие ключи или подтверждения. Смена узла сейчас может потерять ожидающие сообщения.';
      else if (failure instanceof Error && failure.message === 'courier_change_pending') error = 'Сначала дождитесь доставки очереди старого пересыльщика.';
      else if (failure instanceof Error && failure.message === 'courier_disabled') error = 'В окне узла включите LAN-сигналинг или интернет-доставку и сохраните настройки.';
      else if (failure instanceof Error && failure.message === 'courier_lan_update_required') error = 'Обновите установщик ноды и включите LAN-сигналинг для режима «Только LAN».';
      else if (failure instanceof Error && failure.message === 'not_member') error = 'Этот профиль ещё не привязан. Создайте новый код или QR привязки в окне ноды и подключите профиль.';
      else if (failure instanceof Error && failure.message === 'network_not_saved') error = 'Не удалось сохранить LAN-подключение. Профиль привязан, но сигналинг нужно добавить повторно.';
      else if (failure instanceof Error && failure.message === 'not_owner') error = 'Этот узел привязан к другому аккаунту. Управлять очередью может только его владелец.';
      else if (failure instanceof Error && failure.name === 'AbortError') error = 'Узел не ответил вовремя. Проверьте его запуск и доступ к локальной сети.';
      else if (failure instanceof TypeError) error = 'Браузер не смог соединиться с узлом. Проверьте доверие к сертификату, разрешение локальной сети и обновите страницу приложения.';
      else error = 'Не удалось выполнить действие. Проверьте запуск узла, адрес, доверие к сертификату и код привязки. Разрешите доступ к локальной сети, если браузер его запросит.';
    } }
    finally { clearTimeout(timer); if (alive) busy = false; }
  }
  async function inspect(signal: AbortSignal) {
    const setup = parseNodeSetup(url);
    url = setup.url;
    requireNodeNetwork(url, !internetEnabled);
    if (setup.code) { code = setup.code; scannedNodeId = setup.nodeId; }
    const value = await inspectHomeNode(url, signal);
    if (scannedNodeId && value.nodeId !== scannedNodeId) throw new Error('node_identity_changed');
    if (alive) info = value;
  }
  async function request(path: string, value: unknown, signal: AbortSignal) {
    requireNodeNetwork(url, !internetEnabled);
    const identity = signer(); if (!identity || !info) throw new Error('account_locked');
    return signedNodeRequest(url, info.nodeId, identity, address, path, value, signal);
  }
  async function status(signal: AbortSignal) {
    const value = await request('/mailbox/status', {}, signal) as typeof queueStatus;
    if (alive) queueStatus = value;
  }
</script>

<section class="settings-section" style="overflow-wrap:anywhere;">
  {#if mode === 'outgoing'}
  {#if !setupOnly}
  <h4 style="margin-top:0;">{$i18n.text("Отправка через ноду")} <HelpInfo label={$i18n.text("Справка: доставка через ноду")} text={$i18n.text("Нода хранит зашифрованные сообщения до получения, отмены или истечения срока. Перед закрытием приложения дождитесь статуса «На ноде». Он подтверждает сохранение, но не доставку собеседнику. Нода должна оставаться включённой и доступной.")} /></h4>
  <p>{$i18n.text("Отправка через ноду:")} <strong>{courierState.enabled ? $i18n.text("включена") : $i18n.text("выключена")}</strong>.</p>
  {#if courierState.enabled || courierState.pending.length}
    <p role="status">{$i18n("m_2936e6b45126", {v0: (courierStatus.connection === 'connected' ? $i18n.text("есть") : courierStatus.connection === 'checking' ? $i18n.text("проверяем…") : courierStatus.connection === 'offline' ? $i18n.text("нет связи · повторим попытку") : $i18n.text("ещё не проверена")), v1: (courierStatus.lan === 'connected' ? $i18n.text("подключён") : courierStatus.lan === 'disabled' ? $i18n.text("выключен") : $i18n.text("проверяем / нужна обновлённая нода")), v2: (courierStatus.relay === 'connected' ? $i18n.text("подключён") : courierStatus.relay === 'relay_outdated' ? $i18n.text("сервер требует обновления") : courierStatus.relay === 'disabled' ? $i18n.text("выключен") : $i18n.text("подключается"))})}</p>
  {/if}
  <p>{$i18n("m_cbef7b4d1255", {v0: (waitingCount), v1: (courierStatus.stored), v2: (courierState.pending.length)})}</p>
  <details><summary>{$i18n.text("Квота и очередь ноды")}</summary><p>{$i18n("m_7f49d96bf53c", {v0: (courierStatus.queue?.messages??$i18n.text("не проверено"))})}</p><NodeQuotaDetails snapshot={courierStatus.queue} connected={courierStatus.connection==='connected'} /></details>
  <div class="node-help"><span>{$i18n.text("Запас ключей")} <HelpInfo label={$i18n.text("Справка: ключи отложенной доставки")} text={$i18n.text("Одно сообщение использует один одноразовый ключ. Клиент получает новый запас через ноду собеседника, если тот его опубликовал; прямое соединение также пополняет ключи. Пока ключей нет, сообщение ждёт в приложении. Нода не получает закрытые ключи.")} /></span>
  <span>{$i18n.text("Получение")} <HelpInfo label={$i18n.text("Справка: получение с ноды отправителя")} text={$i18n("m_5a6bc55d577b", {v0: (FILE_POLICY_BYTES / (1024 * 1024))})} /></span></div>
  {#if courierState.node}<p><code>{courierState.node.url}</code>
    <button disabled={busy} onclick={() => { url = courierState.node!.url; void work(inspect); }}>{$i18n.text("Проверить ноду")}</button>
    {#if courierState.enabled}<button disabled={busy} onclick={() => work(async () => configureCourier(courierState.node!, false))}>{$i18n.text("Отключить новую отправку через ноду")}</button>{/if}</p>{/if}
  {#if courierState.node}<p class="node-help">{$i18n.text("Отключение отправки")} <HelpInfo label={$i18n.text("Справка: отключение отправки через ноду")} text={$i18n.text("Отключение действует на новые отправки. Уже сохранённые конверты остаются на ноде до получения, вашей отмены или истечения срока. Ключи ожидающих конвертов хранятся на этом устройстве; восстановление только по сиду их не вернёт.")} /></p>{/if}
  {#if courierError}<p role="status">{$i18n.system(courierError)}</p>{/if}
  {/if}
  {:else if !legacyOnly}
  <h4 style="margin-top:0;">{$i18n.text("Получение сообщений")} <HelpInfo label={$i18n.text("Справка: получение сообщений")} text={$i18n.text("Откройте и разблокируйте приложение. Для получения с ноды нужны заранее выданные ключи этого собеседника и подписанное разрешение. Собственная нода и одновременное присутствие отправителя не требуются. Состояние сигналинга ниже не показывает доступность HTTPS-получения — она видна в диагностике.")} /></h4>
  <p role="status">{$i18n.text("Основной канал получения:")} <strong>{!trusted ? $i18n.text("нужен доверенный режим для отложенной доставки") : receivingReady ? $i18n.text("подключён") : $i18n.text("подключение не подтверждено")}</strong>{$i18n("m_0b98564b8bbb", {v0: (receiveKeys)})}</p>
  <HelpInfo label={$i18n.text("Справка: пополнение ключей")} text={$i18n.text("Основной клиент публикует запас открытых ключей на своей ноде. Собеседник может пополнить его без прямого чата. Без ноды ключи обновляются при прямом соединении. Общий счётчик не гарантирует наличие ключей для каждого контакта.")} />
  {/if}
  {#if mode === 'incoming' && legacySetup}
  <h5>{$i18n.text("Мой входящий ящик в LAN")}</h5>
  <p><small>{$i18n.text("Сигналинг и очередь зашифрованных сообщений. Узел должен быть включён и доступен отправителю. Seed и закрытые ключи узлу не передаются. Файлы пока отправляются напрямую.")}</small></p>
  <p>{$i18n("m_05871a383492", {v0: (offlineEnabled ? $i18n.text("включена") : $i18n.text("выключена")), v1: (pendingCount)})}</p>
  {#if offlineNode}<p><small>{$i18n.text("Мой почтовый узел:")} <code>{offlineNode.url}</code></small>
    <button type="button" disabled={busy} onclick={() => { url = offlineNode!.url; void work(inspect); }}>{$i18n.text("Открыть мой узел")}</button>
    {#if offlineEnabled}<button type="button" disabled={busy} onclick={() => work(async () => configureOffline(offlineNode!, false))}>{$i18n.text("Отключить офлайн-доставку")}</button>{/if}</p>{/if}
  <p><small>{$i18n.text("Включение разрешает оставлять ваши новые сообщения на подписанных узлах принятых собеседников и получать сообщения через свой узел. На обоих клиентах включите доставку, затем один раз соединитесь напрямую: они обменяются одноразовыми ключами. Без свободных ключей сообщение останется в очереди. Ключи привязаны к этому устройству; восстановление только по seed не восстанавливает ожидающие конверты.")}</small></p>
  {#if !trusted}<p>{$i18n.text("В недоверенном режиме офлайн-доставка недоступна: ключи нельзя надёжно сохранить.")}</p>{/if}
  {#if offlineError}<p role="status">{$i18n.text(offlineError)}</p>{/if}
  {/if}
  {#if mode === 'outgoing' || legacySetup}
  {#if !trusted}<p>{$i18n.text("Отложенная доставка требует доверенного режима.")}</p>{/if}
  <h5>{mode === 'outgoing' ? $i18n.text("Подключить ноду") : $i18n.text("Подключить ящик в LAN")}</h5>
  <details><summary>{$i18n.text("Установка домашней ноды")}</summary>
  <NodeDownloads />
  <p><small>{$i18n.text("Возьмите приглашение из панели сервера или окна домашней ноды. Для LAN сертификат должен быть доверен на этом устройстве.")}</small></p>
  </details>
  <QrInput bind:value={url} label={$i18n.text("Приглашение или адрес ноды")} disabled={busy} maxlength={4096}
    onScan={()=>scanner=!scanner} onImage={readPairFile} onInput={()=>{info=null;queueStatus=null;result='';code='';scannedNodeId='';}} />
  {#if scanner}<NodeScanner label={$i18n.text("QR привязки или LAN-сигналинга своей ноды")} onResult={acceptPairQr} onClose={() => { scanner = false; }} />{/if}
  <button type="button" disabled={busy || !url.trim()} onclick={() => work(inspect)}>{$i18n.text("Проверить узел")}</button>
  {#if info}
    <p><small>{$i18n.text("ID узла:")} <code>{info.nodeId}</code>{$i18n.text(". Сверьте с окном узла на ПК.")}</small></p>
    {#if info.adminPanel}<a href={homeNodeUrl(url)} target="_blank" rel="noopener noreferrer">{$i18n.text("Открыть панель управления нодой")}</a>{/if}
    {#if mode === 'outgoing' && info.courierProtocol === 'automesh-courier-v1' && isValidAccountId(info.courierAddress)}
      <p><small>{$i18n.text("Mesh ID службы доставки:")} <code>{info.courierAddress}</code></small></p>
      <button type="button" disabled={busy || !trusted || !info.courierEnabled} onclick={() => work(async () => {
        await configureCourier({ url: homeNodeUrl(url), nodeId: info!.nodeId, address: info!.courierAddress! }, true);
        if (alive) result = 'Отправка через ноду включена. После обмена ключами и разрешением собеседники смогут получать сообщения без собственной ноды.';
      })}>{$i18n.text("Включить отправку через ноду")}</button>
      {#if !info.courierEnabled}<p><small>{$i18n.text("Включите LAN-сигналинг или интернет-доставку в окне узла и сохраните настройки.")}</small></p>{/if}
    {/if}
      <label>{$i18n.text("Код привязки")} <input bind:value={code} type="text" autocomplete="off" spellcheck="false" maxlength="48" disabled={busy} /></label>
      <button type="button" disabled={busy} onclick={() => work(async signal => {
        await request(info!.multiMailbox ? '/node/join' : '/node/pair', { code: code.replace(/[\s-]/g, '').toLowerCase() }, signal);
        if (!alive) return; code = ''; await inspect(signal);
        if (info!.signalingEnabled !== false) {
          const signalUrl = new URL('/signal', homeNodeUrl(url)); signalUrl.protocol = 'wss:'; await addSignaling(signalUrl.href);
        }
        if (mode === 'outgoing' && info!.courierEnabled && isValidAccountId(info!.courierAddress)) {
          await configureCourier({ url: homeNodeUrl(url), nodeId: info!.nodeId, address: info!.courierAddress! }, true);
        }
        if (alive) result = 'Профиль подключён. ' + (info!.signalingEnabled !== false ? 'Сервер подключения добавлен. ' : '')
          + (mode === 'outgoing' ? (info!.courierEnabled && isValidAccountId(info!.courierAddress) ? 'Доставка через ноду включена.' : 'Доставка через ноду пока недоступна.') : 'Можно включить собственный входящий ящик ниже.');
      })}>{$i18n.text("Подключить профиль")}</button>
    {#if info.paired}
      {#if mode === 'incoming'}
      <button type="button" disabled={busy} onclick={() => work(async signal => { await status(signal); })}>{$i18n.text("Моя очередь и разрешения")}</button>
      {/if}
      <button type="button" disabled={busy || info.signalingEnabled === false} onclick={() => work(async () => {
        const signalUrl = new URL('/signal', homeNodeUrl(url)); signalUrl.protocol = 'wss:';
        await addSignaling(signalUrl.href); if (alive) result = 'Сервер подключения добавлен.';
      })}>{$i18n.text("Использовать сигналинг этого узла")}</button>
      {#if info.signalingEnabled === false}<p><small>{$i18n.text("LAN-сигналинг выключен в настройках ноды.")}</small></p>{/if}
    {/if}
    {#if mode === 'incoming' && info.chatOfflineDelivery && info.multiMailbox}
      <button type="button" disabled={busy || !trusted} onclick={() => work(async () => {
        await configureOffline({ url: homeNodeUrl(url), nodeId: info!.nodeId }, true);
        if (alive) result = 'Офлайн-доставка включена. Соединитесь с собеседником для обмена ключами.';
      })}>{$i18n.text("Использовать для офлайн-доставки")}</button>
    {:else if mode === 'incoming' || !info.courierProtocol}<p><small>{$i18n.text("Для доставки сообщений обновите установщик узла.")}</small></p>{/if}
  {/if}
  {#if queueStatus}
    <p>{$i18n("m_4556419794ab", {v0: (queueStatus.messages), v1: (Math.ceil(queueStatus.bytes / 1024)), v2: (Math.floor(queueStatus.maxBytes / 1024 / 1024))})}</p>
    <label>{$i18n.text("Разрешить отправителю оставлять конверты")} <input bind:value={sender} maxlength="100" placeholder="Mesh ID" disabled={busy} /></label>
    <button type="button" disabled={busy || !sender.trim()} onclick={() => work(async signal => {
      await request('/mailbox/grant', { address: sender.trim() }, signal); if (!alive) return; sender = ''; await status(signal);
    })}>{$i18n.text("Разрешить")}</button>
    {#each queueStatus.senders as id}<p><code>{id}</code> <button type="button" disabled={busy} onclick={() => work(async signal => {
      await request('/mailbox/revoke', { address: id }, signal); await status(signal);
    })}>{$i18n.text("Отозвать доступ")}</button></p>{/each}
  {/if}
  {#if result}<p role="status">{$i18n.text(result)}</p>{/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
  {#if error && url.trim()}
    <p><small><a href={(() => { try { return `${homeNodeUrl(url)}/node/info`; } catch { return undefined; } })()} target="_blank" rel="noopener noreferrer">{$i18n.text("Открыть проверку HTTPS узла в новой вкладке")}</a>{$i18n.text(". Если браузер показывает ошибку сертификата, установите доверие к сертификату своего узла; не обходите предупреждение.")}</small></p>
  {/if}
  {/if}
</section>
<style>
  .node-help{display:flex;flex-wrap:wrap;gap:8px 16px;color:var(--muted);font-size:13px;margin:12px 0}
  .node-help > span{max-width:100%;min-width:0}
</style>
