<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import { formatBytes } from '$lib/application/storage-summary';
  import ChatIcon from './ChatIcon.svelte';
  let { id, name, kind, url, failed, index, count, fileInfo, sticker, onStickerAction, onMove, onClose, onAction, canReply = true, canForward = true, canShare = true, actionsDisabled = false }:
    { id: string; name: string; kind: 'image' | 'video'; url?: string; failed?: boolean;
      fileInfo: { size: number; mime: string; timestamp: number; sender: string; senderAddress: string };
      sticker?: { packName?: string; canRequest: boolean };
      onStickerAction?(action: 'save' | 'request'): Promise<string>;
      index: number; count: number; onMove(direction: -1 | 1): void; onClose(): void;
      onAction(action: 'download' | 'share' | 'forward' | 'reply' | 'show-in-chat'): void;
      canReply?: boolean; canForward?: boolean; canShare?: boolean; actionsDisabled?: boolean } = $props();
  let dialog: HTMLDialogElement;
  let visible = $state(true);
  let player = $state<HTMLVideoElement>();
  let decodeError = $state(false);
  let actionsOpen = $state(false);
  let infoOpen = $state(false);
  let stickerWorking = $state(false);
  let stickerNotice = $state('');
  let timer: ReturnType<typeof setTimeout>;
  let pointer: { id: number; x: number; y: number; time: number } | null = null;
  let swiped = false;
  const touches = new Set<number>();
  function scheduleHide() {
    clearTimeout(timer);
    if (visible && !actionsOpen && !stickerWorking) timer = setTimeout(() => {
      // Keep keyboard controls available while someone is using them.
      if (dialog?.querySelector(':focus-visible')) { scheduleHide(); return; }
      visible = false;
    }, 3500);
  }
  function show() { visible = true; scheduleHide(); }
  function toggle() { if (swiped) { swiped = false; return; } if (actionsOpen) { closeActions(); return; } visible = !visible; scheduleHide(); }
  function openActions() { infoOpen = false; actionsOpen = true; visible = true; clearTimeout(timer); }
  function closeActions() { infoOpen = false; actionsOpen = false; scheduleHide(); }
  function dismissPanel() { if (infoOpen) infoOpen = false; else closeActions(); }
  function action(value: 'download' | 'share' | 'forward' | 'reply' | 'show-in-chat') { closeActions(); onAction(value); }
  async function stickerAction(value: 'save' | 'request') {
    if (!sticker || !onStickerAction || stickerWorking || actionsDisabled) return;
    const openedId = id;
    stickerWorking = true; stickerNotice = ''; visible = true; clearTimeout(timer);
    try {
      const notice = await onStickerAction(value);
      if (id === openedId) stickerNotice = notice;
    } catch { if (id === openedId) stickerNotice = 'Не удалось выполнить действие. Попробуйте ещё раз.'; }
    finally { stickerWorking = false; scheduleHide(); }
  }
  function move(direction: -1 | 1) { player?.pause(); onMove(direction); if (visible) scheduleHide(); }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' && actionsOpen) {
      event.preventDefault(); event.stopPropagation(); dismissPanel();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (actionsOpen) return;
      // Native video controls own seek/volume keys while focused.
      if (event.target === player) return;
      event.preventDefault(); event.stopPropagation(); move(event.key === 'ArrowLeft' ? -1 : 1);
    } else if (event.key === 'Tab') show();
  }
  function start(event: PointerEvent) {
    clearTimeout(timer);
    swiped = false;
    if (event.pointerType === 'mouse') return;
    touches.add(event.pointerId);
    if (touches.size > 1) { pointer = null; return; }
    if (event.target instanceof Element && event.target.closest('.toolbar, .side, .actions-sheet, .sticker-bar')) return;
    // Do not turn a seek-slider gesture in the native video controls into a swipe.
    if (event.target === player && event.clientY > player.getBoundingClientRect().bottom - 64) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now() };
  }
  function end(event: PointerEvent) {
    touches.delete(event.pointerId);
    scheduleHide();
    const origin = pointer; pointer = null;
    if (!origin || origin.id !== event.pointerId || Date.now() - origin.time > 900) { if (event.target === player) show(); return; }
    const x = event.clientX - origin.x, y = event.clientY - origin.y;
    if (Math.abs(y) >= 70 && Math.abs(y) > Math.abs(x) * 1.5) {
      swiped = true;
      if (y > 0) onClose(); else openActions();
    } else if (!actionsOpen && Math.abs(x) >= 60 && Math.abs(x) > Math.abs(y) * 1.5 && count > 1) {
      swiped = true; move(x < 0 ? 1 : -1);
    } else if (event.target === player) show();
  }
  $effect(() => { id; decodeError=false; actionsOpen=false; infoOpen=false; stickerNotice=''; });
  onMount(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal(); dialog.focus(); scheduleHide();
    return () => { clearTimeout(timer); player?.pause(); dialog.close(); if (previous?.isConnected) previous.focus({preventScroll:true}); };
  });
</script>
<dialog bind:this={dialog} class:controls-hidden={!visible} class:sticker-view={!!sticker} aria-label={sticker ? $i18n.text("Просмотр стикера") : $i18n.text("Просмотр фото и видео")} tabindex="-1"
  oncancel={event => { event.preventDefault(); if (actionsOpen) dismissPanel(); else onClose(); }} onkeydown={key}
  onpointerdown={start} onpointerup={end} onpointercancel={event => {touches.delete(event.pointerId); pointer = null; scheduleHide();}}>
  <div class="stage">
    {#if url && !failed && !decodeError}
      {#key id}
        {#if kind === 'video'}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video bind:this={player} src={url} controls={visible} playsinline preload="metadata" aria-label={name}
            onerror={() => decodeError=true}></video>
        {:else}
          <button class="image-toggle" onclick={toggle} aria-label={visible ? $i18n.text("Скрыть кнопки просмотра") : $i18n.text("Показать кнопки просмотра")}>
            <img src={url} alt={name} onerror={() => decodeError=true} />
          </button>
        {/if}
      {/key}
    {:else}<p class="fallback" role="status">{failed || decodeError ? $i18n.text("Не удалось открыть файл. Можно скачать его из чата.") : $i18n.text("Подготавливаем медиа…")}</p>{/if}
  </div>
  <div class="toolbar" aria-hidden={!visible}>
    <span class="caption"><strong>{index + 1} / {count}</strong><span>{name}</span></span>
    <button class="close more" type="button" onclick={openActions} tabindex={visible ? 0 : -1}
      aria-label={$i18n.text("Действия с медиа")} aria-expanded={actionsOpen} aria-controls="media-actions">⋯</button>
    <button class="close" type="button" onclick={onClose} tabindex={visible ? 0 : -1} aria-label={$i18n.text("Закрыть просмотр")}><ChatIcon name="close" /></button>
  </div>
  {#if count > 1 && !actionsOpen}
    <button class="side previous" onclick={() => move(-1)} aria-label={$i18n.text("Предыдущее фото или видео")}><span aria-hidden="true">‹</span></button>
    <button class="side next" onclick={() => move(1)} aria-label={$i18n.text("Следующее фото или видео")}><span aria-hidden="true">›</span></button>
  {/if}
  {#if sticker && !actionsOpen}
    <div class="sticker-bar" aria-hidden={!visible}>
      {#if sticker.packName}<p class="pack-name">{sticker.packName}</p>{/if}
      <div class="actions-grid">
        <button disabled={actionsDisabled || stickerWorking} tabindex={visible ? 0 : -1} onclick={() => void stickerAction('save')}><span aria-hidden="true">♡</span>{$i18n.text("В мои стикеры")}</button>
        {#if sticker.canRequest}<button disabled={actionsDisabled || stickerWorking} tabindex={visible ? 0 : -1} onclick={() => void stickerAction('request')}><ChatIcon name="send" />{$i18n.text("Запросить набор")}</button>{/if}
      </div>
      {#if stickerWorking || stickerNotice}<p class="sticker-notice" role="status">{stickerWorking ? $i18n.text("Подождите…") : stickerNotice}</p>{/if}
    </div>
  {/if}
  {#if actionsOpen}
    <section class="actions-sheet" id="media-actions" aria-label={infoOpen ? $i18n.text("Информация о файле") : $i18n.text("Действия с медиа")}>
      <header>
        {#if infoOpen}<button class="close" onclick={() => infoOpen = false} aria-label={$i18n.text("Назад к действиям")}><ChatIcon name="reply" /></button>{/if}
        <strong>{infoOpen ? $i18n.text("Информация о файле") : $i18n.text("Медиа")}</strong>
        <button class="close" onclick={closeActions} aria-label={$i18n.text("Закрыть действия")}><ChatIcon name="close" /></button>
      </header>
      {#if infoOpen}
        <dl class="file-info">
          <dt>{$i18n.text("Название")}</dt><dd>{name}</dd>
          <dt>{$i18n.text("Формат")}</dt><dd>{fileInfo.mime || $i18n.text("Не указан")}</dd>
          <dt>{$i18n.text("Размер")}</dt><dd>{$i18n.system(formatBytes(fileInfo.size))} <small>{$i18n("m_0cc3e041c3df", {v0: (fileInfo.size.toLocaleString($uiLocale))})}</small></dd>
          <dt>{$i18n.text("Дата сообщения")}</dt><dd>{new Date(fileInfo.timestamp).toLocaleString($uiLocale)}</dd>
          <dt>{$i18n.text("Отправитель")}</dt><dd>{fileInfo.sender}<small class="sender-address">{fileInfo.senderAddress}</small></dd>
        </dl>
      {:else}
      <div class="actions-grid">
        {#if sticker}
          <button disabled={actionsDisabled || stickerWorking} onclick={() => void stickerAction('save')}><span aria-hidden="true">♡</span>{$i18n.text("В мои стикеры")}</button>
          {#if sticker.canRequest}<button disabled={actionsDisabled || stickerWorking} onclick={() => void stickerAction('request')}><ChatIcon name="send" />{$i18n.text("Запросить набор")}</button>{/if}
        {/if}
        <button disabled={actionsDisabled} onclick={() => action('download')}><ChatIcon name="download" />{$i18n.text("Скачать")}</button>
        <button disabled={actionsDisabled || !canShare} onclick={() => action('share')}><ChatIcon name="share" />{$i18n.text("Поделиться")}</button>
        <button disabled={actionsDisabled || !canForward} onclick={() => action('forward')}><ChatIcon name="forward" />{$i18n.text("Переслать")}</button>
        <button disabled={actionsDisabled || !canReply} onclick={() => action('reply')}><ChatIcon name="reply" />{$i18n.text("Ответить")}</button>
        <button class="show-in-chat" disabled={actionsDisabled} onclick={() => action('show-in-chat')}><ChatIcon name="chat" />{$i18n.text("Показать в чате")}</button>
        <button onclick={() => infoOpen = true}><ChatIcon name="info" />{$i18n.text("О файле")}</button>
      </div>
      {#if sticker && (stickerWorking || stickerNotice)}<p class="sticker-notice" role="status">{stickerWorking ? $i18n.text("Подождите…") : stickerNotice}</p>{/if}
      {/if}
    </section>
  {/if}
</dialog>
<style>
  dialog { position:fixed; inset:0; width:100vw; max-width:none; height:100dvh; max-height:none; margin:0; padding:0; border:0; border-radius:0; overflow:hidden; background:#091017; color:white; box-shadow:none; box-sizing:border-box; }
  dialog::backdrop { background:#091017; }
  dialog.sticker-view { background:transparent; }
  dialog.sticker-view::backdrop { background:#091017b3; backdrop-filter:blur(6px); }
  .sticker-view img { width:min(70vw,440px); height:min(65dvh,440px); object-fit:contain; }
  .stage { position:absolute; inset:0; display:grid; place-items:center; touch-action:pinch-zoom; }
  .image-toggle { display:grid; place-items:center; width:100%; height:100%; min-width:0; min-height:0; padding:0; margin:0; border:0; border-radius:0; background:transparent; cursor:default; }
  img,video { display:block; width:100%; height:100%; max-width:100vw; max-height:100dvh; object-fit:contain; border-radius:0; }
  video { background:#091017; }
  .toolbar { position:absolute; inset:0 0 auto; z-index:3; display:flex; align-items:center; gap:12px; padding:max(12px,env(safe-area-inset-top)) max(12px,env(safe-area-inset-right)) 16px max(12px,env(safe-area-inset-left)); background:linear-gradient(#0009,transparent); transition:opacity .18s; pointer-events:none; }
  .caption { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; text-shadow:0 1px 5px #000; font-size:13px; }
  .caption strong { font-size:16px; } .caption>span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .close { pointer-events:auto; width:44px; height:44px; padding:8px; display:grid; place-items:center; color:white; border:1px solid #ffffff40; background:#0005; border-radius:50%; }
  .more { font-size:28px; line-height:1; }
  .actions-sheet { position:absolute; z-index:4; bottom:0; left:50%; transform:translateX(-50%); width:min(480px,100%); box-sizing:border-box; padding:12px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left)); background:#17242ff2; border:1px solid #ffffff30; border-bottom:0; border-radius:22px 22px 0 0; box-shadow:0 -8px 32px #0005; max-height:70dvh; overflow:auto; touch-action:pan-y; }
  .actions-sheet header { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
  .actions-sheet header strong { flex:1; min-width:0; }
  .actions-sheet header .close { flex-shrink:0; }
  .file-info { margin:0; font-size:14px; line-height:1.5; }
  .file-info dt { color:#b3c4d0; font-size:12px; margin-top:12px; }
  .file-info dd { margin:2px 0 0; overflow-wrap:anywhere; }
  .file-info small { color:#b3c4d0; font-size:12px; }
  .sender-address { display:block; margin-top:3px; }
  .actions-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
  .actions-grid button { display:flex; align-items:center; justify-content:center; gap:8px; min-height:52px; padding:10px 6px; font-size:14px; color:white; background:#ffffff0d; border:1px solid #ffffff30; border-radius:12px; }
  .actions-grid button:disabled { opacity:.4; }
  .sticker-bar { position:absolute; bottom:0; left:50%; transform:translateX(-50%); z-index:3; width:min(480px,100%); box-sizing:border-box; padding:16px max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left)); background:linear-gradient(transparent,#091017ed 25%); transition:opacity .18s; }
  .pack-name { margin:0 0 8px; text-align:center; font-size:13px; overflow-wrap:anywhere; }
  .sticker-notice { font-size:13px; line-height:1.4; margin:10px 0 0; overflow-wrap:anywhere; }
  .sticker-bar .actions-grid button:only-child { grid-column:1 / -1; }
  .side { position:absolute; top:max(76px,calc(env(safe-area-inset-top) + 64px)); bottom:max(70px,calc(env(safe-area-inset-bottom) + 64px)); z-index:2; width:clamp(44px,6vw,88px); margin:0; padding:0; border:0; border-radius:14px; color:white; background:transparent; touch-action:manipulation; }
  /* Do not inherit the app's light hover background (sticky after touch taps). */
  .side:hover:not(:disabled), .side:active, .side:focus,
  .image-toggle:hover:not(:disabled), .image-toggle:active, .image-toggle:focus { background:transparent; border-color:transparent; color:white; -webkit-tap-highlight-color:transparent; }
  .side, .image-toggle { -webkit-tap-highlight-color:transparent; }
  .close:hover:not(:disabled), .close:active { background:#0005; border-color:#ffffff40; color:white; }
  .actions-grid button:hover:not(:disabled), .actions-grid button:active { background:#ffffff0d; border-color:#ffffff30; color:white; }
  .previous { left:max(0px,env(safe-area-inset-left)); } .next { right:max(0px,env(safe-area-inset-right)); }
  .side>span { display:grid; place-items:center; width:100%; height:100%; border-radius:14px; background:linear-gradient(90deg,#0005,#0001); font-size:46px; text-shadow:0 1px 5px black; transition:opacity .18s; }
  .next>span { background:linear-gradient(270deg,#0005,#0001); }
  .controls-hidden .toolbar,.controls-hidden .side>span { opacity:0; }
  .controls-hidden .close { pointer-events:none; }
  .controls-hidden .sticker-bar { opacity:0; pointer-events:none; }
  .side:focus-visible>span { opacity:1; outline:2px solid white; outline-offset:-3px; }
  .fallback { max-width:70%; text-align:center; padding:18px; }
  @media(prefers-reduced-motion:reduce) { .toolbar,.side>span,.sticker-bar { transition:none; } }
</style>
