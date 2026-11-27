<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import type { ChatEntry } from './session-chats';
  import { canDownloadMessage, canStopFile, type MessageStatus } from './message-presentation';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import FileSharePanel from './FileSharePanel.svelte';
  import {LEGACY_REACTIONS as REACTIONS} from './reactions';
  type View = 'menu' | 'status' | 'route' | 'share';
  let { message, status, recipient, courier, shareText, openView, disabled = false, canReply, onOpen, onClose,
    onReply, onForward, onSelect, onStop, onDownload, onDelete, onHide, onRoute, onStatus, onPin, pinned = false, canPin = true, canForward = true, canSelect = true, loadShareFile, onCancelNode, onRetryNode, onRetryRadio, channelMode=false, onCopy, onRetryChannel,onReact,onEdit }: {
    message: ChatEntry; status: MessageStatus; recipient: string; courier?: string; shareText: string;
    openView: View | null; disabled?: boolean; canReply: boolean;
    onOpen: (view: View) => void; onClose: () => void; onReply: () => void; onForward: () => void;
    onSelect: () => void; onStop?: () => void; onDownload: () => void; onDelete?: () => void; onHide?: () => void; onRoute?: () => void;
    onStatus?: () => void;
    onPin?: () => void; pinned?: boolean; canPin?: boolean; canForward?: boolean; canSelect?: boolean;
    onCancelNode?:()=>void; onRetryNode?:()=>void;
    onRetryRadio?:()=>void; channelMode?:boolean;onCopy?:()=>void;onRetryChannel?:()=>void;
    loadShareFile: () => Promise<File>;
    onReact?:(emoji:string)=>void;onEdit?:()=>void;
  } = $props();
  let error = $state('');
  let request = 0;
  const downloadable = $derived(canDownloadMessage(message));
  function mountDialog(node: HTMLDialogElement) {
    const previous = document.activeElement as HTMLElement | null;
    node.showModal();
    return { destroy() { request++; error = ''; node.close(); if (previous?.isConnected) previous.focus(); } };
  }
  function run(action: () => void) { onClose(); action(); }
  function canShareText() { return typeof navigator !== 'undefined' && typeof navigator.share === 'function'; }
  async function share() {
    const token = request; error = '';
    try {
      if (canShareText()) await navigator.share({ text: shareText });
      else { await navigator.clipboard.writeText(shareText); if (token === request) error = 'Текст скопирован.'; return; }
      if (token === request) onClose();
    } catch (e) {
      if (token === request && !(e instanceof Error && e.name === 'AbortError')) error = 'Не удалось поделиться. Можно скачать файл или скопировать текст.';
    }
  }
</script>
<button type="button" class="trigger" aria-label={$i18n.text("Действия с сообщением")} title={$i18n.text("Действия с сообщением")} aria-haspopup="dialog" aria-expanded={!!openView} disabled={disabled} onclick={() => onOpen('menu')}>⋯</button>
{#if openView}
  <dialog use:mountDialog aria-label={openView === 'menu' ? $i18n.text("Действия с сообщением") : openView === 'status' ? $i18n.text("Статус сообщения") : openView === 'route' ? $i18n.text("Путь сообщения") : $i18n.text("Поделиться вне Automesh")} oncancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h3>{openView === 'menu' ? $i18n.text("Сообщение") : openView === 'status' ? $i18n.text("Статус") : openView === 'route' ? $i18n.text("Известный путь") : $i18n.text("Поделиться")}</h3><button type="button" onclick={onClose} aria-label={$i18n.text("Закрыть")}>✕</button></header>
    {#if openView === 'menu'}
      {#if onReact}<div class="reaction-picker" role="group" aria-label={$i18n.text('Реакция на сообщение')}>{#each REACTIONS as emoji}<button type="button" disabled={disabled} onclick={()=>run(()=>onReact?.(emoji))} aria-label={$i18n.text('Реакция на сообщение')+' '+emoji}>{emoji}</button>{/each}</div>{/if}
      <div class="actions">
        {#if onEdit}<button disabled={disabled} onclick={()=>run(onEdit!)}><span class="action-icon" aria-hidden="true">✎</span> {$i18n.text('Изменить текст')}</button>{/if}
        {#if onCopy}<button disabled={disabled} onclick={()=>run(onCopy!)}><span class="action-icon" aria-hidden="true">⧉</span> {$i18n.text("Скопировать текст")}</button>{/if}
        {#if onRetryChannel}<button disabled={disabled} onclick={()=>run(onRetryChannel!)}><span class="action-icon" aria-hidden="true">↻</span> {$i18n.text("Отправить снова")}</button>{/if}
        <button disabled={!canReply || disabled} onclick={() => run(onReply)}><span class="action-icon" aria-hidden="true">↩</span> {$i18n.text("Ответить")}</button>
        {#if !channelMode && onPin}<button disabled={!canReply || disabled || !canPin} title={!canPin ? $i18n.text("Нет разрешения на эту функцию") : undefined} onclick={() => run(onPin!)}><span class="action-icon" aria-hidden="true">⌖</span> {pinned ? $i18n.text("Снять мой закреп") : $i18n.text("Закрепить для обоих")}</button>{/if}
        <button disabled={disabled || !downloadable || !canForward} title={!canForward ? $i18n.text("Пока недоступно на подключённом устройстве") : undefined} onclick={() => run(onForward)}><span class="action-icon" aria-hidden="true">↪</span> {$i18n.text("Переслать")}</button>
        <button disabled={disabled || !canSelect} title={!canSelect ? $i18n.text("Пока недоступно на подключённом устройстве") : undefined} onclick={() => run(onSelect)}><span class="action-icon" aria-hidden="true">☑</span> {$i18n.text("Выбрать")}</button>
        {#if onCancelNode && !message.nodeQueue && !['delivered','read'].includes(message.delivery??'')}<button disabled={disabled} onclick={()=>run(onCancelNode!)}><span class="action-icon" aria-hidden="true">⊘</span> {$i18n.text("Отменить на ноде")}</button>{/if}
        {#if onRetryNode && ['canceled','expired'].includes(message.nodeQueue??'')}<button disabled={disabled || !!message.fileDeleted} onclick={()=>run(onRetryNode!)}><span class="action-icon" aria-hidden="true">↻</span> {$i18n.text("Отправить снова")}</button>{/if}
        {#if onRetryRadio}<button disabled={disabled||['queued','transmitting'].includes(message.radioDelivery??'')} onclick={()=>run(onRetryRadio!)}><span class="action-icon" aria-hidden="true">↻</span> {$i18n.text('Повторить по LoRa')}</button>{/if}
        {#if onStop && canStopFile(message) && !onCancelNode}<button disabled={disabled} onclick={() => run(onStop!)}><span class="action-icon" aria-hidden="true">⊘</span> {$i18n.text("Остановить передачу")}</button>{/if}
        <button disabled={disabled || !downloadable} onclick={() => onOpen('share')}><span class="action-icon" aria-hidden="true">↑</span> {$i18n.text("Поделиться вне Automesh")}</button>
        <button disabled={disabled || !downloadable} onclick={() => run(onDownload)}><span class="action-icon" aria-hidden="true">↓</span> {$i18n("m_c82942a6cdbc", {v0: (message.file ? $i18n.text("файл") : $i18n.text("текст"))})}</button>
        <button onclick={() => onStatus ? run(onStatus) : onOpen('status')}><span class="action-icon" aria-hidden="true">ⓘ</span> {$i18n.text("Подробнее о статусе")}</button>
        {#if !channelMode}<button onclick={() => onRoute ? run(onRoute) : onOpen('route')}><span class="action-icon" aria-hidden="true">⌁</span> {$i18n.text("Проверить путь")}</button>{/if}
        {#if onDelete || onHide}<button class="danger" disabled={disabled} onclick={() => run((onDelete ?? onHide)!)}><span class="action-icon" aria-hidden="true">×</span> {$i18n.text(onDelete ? "Удалить у меня" : "Скрыть у меня")}</button>{/if}
      </div>
      {#if !downloadable}<small>{$i18n.text("Для пересылки, скачивания и внешней отправки сначала получите файл целиком.")}</small>{/if}
    {:else if openView === 'status'}
      <p class:error={status.tone === 'error'}><strong>{status.icon} {$i18n.system(status.label)}</strong></p>
      <p>{$i18n.system(status.detail)}</p>
      {#if message.fileDeleted}<p>{$i18n.text("Файл удалён с этого устройства.")}</p>{/if}
      <small>{$i18n.text("ID сообщения:")} <code>{message.id}</code><br />{new Date(message.timestamp).toLocaleString($uiLocale)}</small>
      {#if !channelMode}<HelpInfo label={$i18n.text("Справка: статусы сообщений")} text={$i18n.text("«На ноде» подтверждает хранение, «Доставлено» — получение клиентом собеседника, «Прочитано» — его отметку о прочтении. Процент показывает передачу байтов, а не доставку. Ожидание не всегда означает ошибку; если нужно действие, причина указана в статусе.")} />{/if}
    {:else if openView === 'route'}
      <ol><li>{$i18n.text("Автор")} <code>{message.from}</code></li>
        {#if courier}<li>{$i18n.text("Нода")} <code>{courier}</code></li>{/if}
        <li>{$i18n.text("Получатель")} <code>{recipient}</code></li></ol>
      <p>{message.courierVia ? $i18n.text("Принято через эту ноду; подписи автора и пересыльщика проверены.") : courier ? $i18n.text("Эта нода подтвердила хранение. Доставка получателю ещё не подтверждена.") : $i18n.text("Сведения о промежуточной ноде не сохранены. Полный сетевой маршрут неизвестен.")}</p>
      <small>{$i18n.text("Это известные участники доставки, не трассировка IP и не доказательство всех промежуточных переходов. Автор пересланного сообщения указан переславшим; его исходная подпись здесь не подтверждается.")}</small>
    {:else}
      {#if message.file}
        {#key message.id}<FileSharePanel name={message.file.name} load={loadShareFile} download={() => run(onDownload)} close={onClose} />{/key}
      {:else}
        <p>{$i18n.text(channelMode?"Получатели и выбранное приложение смогут сохранить копию текста.":"Снаружи Automesh это уже не защищённый чат. Получатели и выбранное приложение смогут сохранить копию.")}</p>
        <textarea readonly aria-label={$i18n.text("Текст для внешней отправки")} value={shareText}></textarea>
        <button onclick={() => void share()}>{canShareText() ? $i18n.text("Поделиться текстом") : $i18n.text("Скопировать текст")}</button>
        {#if error}<p role="status">{$i18n.text(error)}</p>{/if}
      {/if}
    {/if}
  </dialog>
{/if}
<style>
  .trigger { background:transparent; border:0; padding:0; min-width:36px; min-height:36px; font-size:24px; line-height:1; }
  dialog { width:min(380px, calc(100vw - 40px)); max-height:80dvh; box-sizing:border-box; overflow:auto; font-size:14px; }
  header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
  h3 { margin:0; font-size:18px; } header button { border:0; background:transparent; font-size:16px; }
  .actions { display:grid; gap:3px; } .actions button { display:flex; align-items:center; gap:8px; text-align:left; border:0; min-height:42px; font-size:14px; }
  .reaction-picker{display:flex;gap:3px;justify-content:space-between;margin:4px 0 12px}.reaction-picker button{padding:5px;min-width:36px;min-height:40px;font-size:21px;border:0}
  .action-icon { display:inline-grid; place-items:center; width:20px; flex-shrink:0; font-size:16px; line-height:1; }
  .danger, .error { color:var(--danger); } small { color:var(--muted); font-size:13px; }
  p { line-height:1.5; } code { display:block; font-size:12px; overflow-wrap:anywhere; } li { margin:12px 0; }
  textarea { width:100%; min-height:100px; box-sizing:border-box; margin-bottom:12px; }
  @media(max-width:700px) { dialog { width:calc(100vw - 24px); max-height:85dvh; } .actions button { min-height:44px; } }
</style>
