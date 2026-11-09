<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { nodeCards, type ManagedNode } from './node-registry';
  import { isLocalHost } from '$lib/transport/client-config';
  import type { CourierStatus } from './courier-controller';
  import NodeStartGuide from './NodeStartGuide.svelte';
  import NodeDownloads from './NodeDownloads.svelte';
  import {queueQuotaFull,queueQuotaLabel} from './queue-quota';
  import NodeQuotaDetails from './NodeQuotaDetails.svelte';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  let { managed, outgoing, inbox, directory = null, enabled, status, pending, busy, onConnect, onOutgoing, onIncoming, onForget, onUse }:
    { managed: ManagedNode[]; outgoing: { url: string; nodeId: string } | null; inbox: { url: string; nodeId: string } | null;
      directory?: {url:string;nodeId:string} | null; enabled: boolean; status: CourierStatus; pending: number; busy: boolean; onConnect(): void; onOutgoing(): void; onIncoming(): void;
      onForget(url: string): void; onUse?: (node: {url:string;nodeId:string}) => void } = $props();
  const cards = $derived(nodeCards(managed, outgoing, inbox,directory));
  const kind = (node: ManagedNode) => node.kind ?? (isLocalHost(new URL(node.url).hostname) ? 'home' : 'server');
</script>
<section class="nodes-panel">
  <div class="heading"><h4>{$i18n.text("Мои ноды")}</h4><button disabled={busy} onclick={onConnect}>{$i18n.text("＋ Подключить ноду")}</button></div>
  <details><summary>{$i18n.text("Установить новую ноду")}</summary>
    <NodeStartGuide {busy} onSetup={onOutgoing} />
    <NodeDownloads />
  </details>
  {#if !cards.length}<p class="muted">{$i18n.text("Подключите ноду по приглашению или добавьте свою для управления.")}</p>{/if}
  {#each ['server','home'] as group}
  {#if cards.some(node => kind(node) === group)}<h4>{group === 'server' ? $i18n.text("Серверные ноды") : $i18n.text("Домашние ноды")}</h4>{/if}
  {#each cards.filter(node => kind(node) === group) as node (node.url)}
    <article>
      <h4>{node.name} <small>{isLocalHost(new URL(node.url).hostname) ? 'LAN' : $i18n.text("Интернет")}</small></h4>
      <code>{node.url}</code>
      <div class="roles">{#if node.outgoing}<span>{$i18n.text("Доставка моих сообщений")}</span>{/if}{#if node.inbox}<span>{$i18n.text("LAN-ящик")}</span>{/if}{#if node.directory}<span>{$i18n.text("Проверка прав устройств")}</span>{/if}{#if node.managed}<span>{$i18n.text("Панель управления")}</span>{/if}</div>
      {#if !node.outgoing}<p class="muted">{$i18n.text("Не выбрана для отправки.")} <HelpInfo label={$i18n.text("Справка: роль ноды")} text={$i18n.text("Доступ к панели управления не подключает профиль к очереди. Для отправки выберите эту ноду и подтвердите доступ профиля по приглашению.")} /></p>{/if}
      {#if node.identityConflict}<p role="alert">{$i18n.text("ID ноды различается в сохранённых подключениях. Проверьте ноду перед входом или сменой адреса.")}</p>{/if}
      {#if node.outgoing}
        <p class="muted"><span class="dot" class:connected={status.connection === 'connected'}></span>{$i18n("m_7ddf5a0456d0", {v0: (status.connection === 'connected' ? $i18n.text("Нода на связи") : $i18n.text("Связь с очередью не подтверждена")), v1: (pending), v2: (!enabled ? $i18n.text("· новая отправка выключена") : '')})}</p>
        {#if status.queue?.quota&&queueQuotaFull(status.queue.quota)}<p role="status">{$i18n.text(queueQuotaLabel(status.queue.quota))}</p>{/if}
        <details><summary>{$i18n.text("Квота и очередь ноды")}</summary><p>{$i18n("m_7f49d96bf53c", {v0: (status.queue?.messages??$i18n.text("не проверено"))})}</p><NodeQuotaDetails snapshot={status.queue} connected={status.connection==='connected'} /></details>
      {/if}
      <div class="actions">
        {#if node.managed && !node.identityConflict}<a href={node.url} target="_blank" rel="noopener noreferrer">{$i18n.text("Открыть панель")}</a>{/if}
        {#if node.outgoing}<button disabled={busy} onclick={onOutgoing}>{$i18n.text("Доставка и очередь")}</button>{/if}
        {#if onUse && !node.outgoing && !node.identityConflict}<button disabled={busy} onclick={() => onUse?.(node)}>{$i18n.text("Использовать для доставки")}</button>{/if}
        {#if node.inbox}<span class="muted">{$i18n.text("Дополнительный ящик — в продвинутых параметрах.")}</span>{/if}
        {#if node.managed}<details><summary>{$i18n.text("Ещё")}</summary><button disabled={busy} onclick={() => onForget(node.url)}>{$i18n.text("Убрать из списка")}</button><small class="muted">{$i18n.text("Удаляется только закладка, не привязка и не очередь.")}</small></details>{/if}
      </div>
      {#if node.managed}<small class="muted">{$i18n.text("Права администратора проверяются при входе в панель.")}</small>{/if}
    </article>
  {/each}
  {/each}
  <HelpInfo label={$i18n.text("Справка: тип ноды")} text={$i18n.text("Домашние и серверные ноды используют одну модель доставки. Тип подтверждается при проверке; для старых записей определяется по адресу предварительно. Само наличие ноды в списке не подтверждает связь или доступ к очереди.")} />
  <button disabled={busy} onclick={onIncoming}>{$i18n.text("Получение сообщений")}</button>
  <details><summary>{$i18n.text("Как это устроено?")}</summary>
    <p>{$i18n.text("Нода хранит зашифрованную очередь. Для новых отправок профиль использует одну выбранную ноду; работающий прямой канал имеет приоритет.")}</p>
    <p>{$i18n.text("Приглашение даёт доступ к очереди, а управление требует отдельных прав администратора. Сид и пароль аккаунта ноде не передаются.")}</p>
    <p>{$i18n.text("Несколько сигналингов помогают установить связь, но не копируют очередь между нодами. Получение по HTTPS работает независимо от сигналинга с ранее выданными ключами и разрешением.")}</p>
    <p>{$i18n.text("«Убрать из списка» удаляет только закладку. Права и очередь на ноде сохраняются.")}</p>
  </details>
</section>
<style>
  .heading,.actions,.roles { display:flex; flex-wrap:wrap; align-items:center; gap:8px; } .heading{justify-content:space-between}
  article{border:1px solid var(--border,#d2dfe4);border-radius:14px;padding:14px;margin:12px 0;overflow-wrap:anywhere}
  h4{margin:0 0 8px}h4 small,.muted{color:var(--muted)}.roles{margin:10px 0}.roles span{font-size:12px;background:var(--panel,#eef7f4);border-radius:8px;padding:4px 8px}
  .actions a{padding:10px;color:var(--accent,#126e69)}.actions button{font-size:14px}details{margin-top:16px}p{line-height:1.5}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--muted);margin-right:6px}.dot.connected{background:var(--success)}.actions details{margin:0}.actions details small{display:block;max-width:30ch}.actions summary{cursor:pointer;padding:10px 36px 10px 10px}
</style>
