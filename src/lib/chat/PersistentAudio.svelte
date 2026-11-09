<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount, tick, untrack } from 'svelte';
  import ChatIcon from './ChatIcon.svelte';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import { formatBytes } from '$lib/application/storage-summary';
  import { adjacentAudio, orderedAudio, reconcileShuffle, type AudioOrder, type AudioRepeat, type AudioQueueTrack } from './audio-queue';

  let { id, tracks, load, loadShareFile, onSelect, onAction, onClose, pauseForVideo = false, disabled = false }:
    { id: string; tracks: AudioQueueTrack[]; load(id: string): Promise<{bytes:Uint8Array;mime:string}>;
      loadShareFile(id: string): Promise<File>; onSelect(id: string): void;
      onAction(id: string, action: 'download' | 'forward' | 'show-in-chat'): void;
      onClose(): void; pauseForVideo?: boolean; disabled?: boolean } = $props();
  let player = $state<HTMLAudioElement>();
  let url = $state(''), loading = $state(true), error = $state(''), playing = $state(false);
  let current = $state(0), duration = $state(0), volume = $state(1), muted = $state(false);
  let volumeUnsupported = $state(false);
  let queueOpen = $state(false), menuId = $state('');
  let menuView = $state<'menu' | 'info' | 'share'>('menu');
  let shareFile = $state<File | null>(null), shareBusy = $state(false), shareError = $state('');
  let shareRequest = 0, disposed = false;
  let order = $state<AudioOrder>('reverse'), repeat = $state<AudioRepeat>('none');
  let shuffled = $state<string[]>([]);
  const selected = $derived(tracks.find(track => track.id === id));
  const ids = $derived(orderedAudio(tracks.map(track => track.id), order, shuffled));
  const orderedTracks = $derived(ids.map(key => tracks.find(track => track.id === key)!).filter(Boolean));
  const menuTrack = $derived(tracks.find(track => track.id === menuId));
  const orderLabel = $derived(order === 'reverse' ? 'От свежих к старым' : order === 'forward' ? 'От старых к свежим' : 'Перемешивание');
  const repeatLabel = $derived(repeat === 'none' ? 'Без повтора' : repeat === 'all' ? 'Повтор всей очереди' : 'Повтор одного трека');
  const clock = (time: number) => Math.floor(time / 60) + ':' + String(Math.floor(time % 60)).padStart(2,'0');

  function playbackState() {
    if (!disposed && 'mediaSession' in navigator) try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch {}
  }
  async function play() {
    const audio = player, trackId = id;
    if (!audio || loading || !url || pauseForVideo || disabled) return;
    try { await audio.play(); if (!disposed && id === trackId) error = ''; }
    catch { if (!disposed && id === trackId) error = 'Нажмите ▶ для воспроизведения.'; }
  }
  function toggle() { if (playing) player?.pause(); else void play(); }
  function cycleOrder() { if (!disabled) order = order === 'reverse' ? 'forward' : order === 'forward' ? 'shuffle' : 'reverse'; }
  function cycleRepeat() { if (!disabled) repeat = repeat === 'none' ? 'all' : repeat === 'all' ? 'one' : 'none'; }
  function seek(time: number) { if (player && Number.isFinite(duration) && duration > 0) player.currentTime = Math.min(duration, Math.max(0,time)); }
  function step(direction: -1 | 1) {
    if (disabled || pauseForVideo) return;
    if (direction === -1 && current > 3) { seek(0); return; }
    const next = adjacentAudio(ids, id, direction, repeat === 'all');
    if (next && next !== id) onSelect(next);
    else if (next === id || direction === -1) { seek(0); void play(); }
  }
  function ended() {
    playing = false; playbackState();
    if (disabled || pauseForVideo) return;
    if (repeat === 'one') { seek(0); void play(); return; }
    step(1);
  }
  function setVolume(value: number) {
    if (!player) return;
    try {
      player.volume = value;
      volumeUnsupported = Math.abs(player.volume - value) > .01;
      if (!volumeUnsupported) { volume = value; if (value > 0) { muted = false; player.muted = false; } }
    } catch { volumeUnsupported = true; }
  }
  function toggleMute() { if (player) { muted = !muted; player.muted = muted; } }
  function closeMenu() { shareRequest++; menuId = ''; menuView = 'menu'; shareFile = null; shareBusy = false; shareError = ''; }
  function closeQueue() { closeMenu(); queueOpen = false; }
  export function dismissOverlay(): boolean {
    if (!queueOpen) return false;
    if (menuId && menuView !== 'menu') {
      shareRequest++; shareFile = null; shareBusy = false; shareError = ''; menuView = 'menu';
    } else if (menuId) closeMenu();
    else closeQueue();
    return true;
  }
  function openMenu(trackId: string) { closeMenu(); menuId = trackId; }
  function run(action: 'download' | 'forward' | 'show-in-chat') {
    const trackId = menuId;
    if (!trackId || disabled) return;
    closeQueue(); onAction(trackId, action);
  }
  async function prepareShare() {
    if (!menuTrack || disabled) return;
    menuView = 'share'; shareError = ''; shareBusy = true;
    const trackId = menuId, token = ++shareRequest;
    try { const file = await loadShareFile(trackId); if (!disposed && token === shareRequest) shareFile = file; }
    catch (e) { if (!disposed && token === shareRequest) shareError = e instanceof Error ? e.message : 'Не удалось подготовить файл.'; }
    finally { if (!disposed && token === shareRequest) shareBusy = false; }
  }
  function canShare() { return !!shareFile && !!navigator.share && !!navigator.canShare?.({files:[shareFile]}); }
  async function share() {
    if (!shareFile || disabled || !canShare()) return;
    const token = shareRequest;
    try { await navigator.share({files:[shareFile]}); if (!disposed && token === shareRequest) closeMenu(); }
    catch(e) { if (!disposed && token === shareRequest && !(e instanceof Error && e.name === 'AbortError')) shareError = 'Не удалось поделиться. Можно скачать файл.'; }
  }

  $effect(() => {
    const available = tracks.map(track => track.id), mode = order;
    untrack(() => { shuffled = mode === 'shuffle' ? reconcileShuffle(available, shuffled, id) : []; });
  });
  $effect(() => { if (menuId && !menuTrack) untrack(closeMenu); });
  $effect(() => { if (pauseForVideo && player) player.pause(); });
  $effect(() => {
    const trackId = id, loader = load;
    return untrack(() => {
      let canceled = false, blobUrl = '';
      player?.pause(); url = ''; loading = true; error = ''; current = 0; duration = 0; playing = false;
      void loader(trackId).then(async media => {
        if (canceled || disposed) return;
        blobUrl = URL.createObjectURL(new Blob([media.bytes as BlobPart], {type:media.mime})); url = blobUrl;
        loading = false; await tick();
        if (canceled || disposed) return;
        if (player) { try { player.volume = volume; } catch {} player.muted = muted; }
        await play();
      }).catch(() => { if (!canceled && !disposed) { loading = false; error = 'Не удалось открыть аудио. Можно скачать файл из очереди.'; } });
      return () => {
        canceled = true; player?.pause(); player?.removeAttribute('src'); player?.load();
        if (blobUrl) URL.revokeObjectURL(blobUrl);
      };
    });
  });
  $effect(() => {
    const title = selected?.name;
    if (title && typeof navigator !== 'undefined' && 'mediaSession' in navigator) try { navigator.mediaSession.metadata = new MediaMetadata({title}); } catch {}
  });
  onMount(() => {
    const session = 'mediaSession' in navigator ? navigator.mediaSession : null;
    const handlers = { play:()=>void play(), pause:()=>player?.pause(), stop:onClose,
      previoustrack:()=>step(-1), nexttrack:()=>step(1),
      seekbackward:()=>seek((player?.currentTime ?? 0)-10), seekforward:()=>seek((player?.currentTime ?? 0)+10),
      seekto:(details:MediaSessionActionDetails)=>seek(details.seekTime ?? player?.currentTime ?? 0) };
    if (session) for (const [action, handler] of Object.entries(handlers)) try { session.setActionHandler(action as MediaSessionAction, handler); } catch {}
    return () => {
      disposed = true; shareRequest++; shareFile = null; player?.pause();
      if (session) {
        for (const action of Object.keys(handlers)) try { session.setActionHandler(action as MediaSessionAction, null); } catch {}
        session.metadata = null; session.playbackState = 'none';
      }
    };
  });
</script>

{#snippet playButton()}
  <button class="play" onclick={toggle} disabled={disabled || loading || !url || pauseForVideo} aria-label={playing?$i18n.text("Приостановить аудио"):$i18n.text("Воспроизвести аудио")} title={playing?$i18n.text("Пауза"):$i18n.text("Воспроизвести")}>
    <ChatIcon name={playing ? 'stop' : 'play'} />
  </button>
{/snippet}
<section class="audio-bar" aria-label={$i18n.text("Аудиоплеер")}>
  <audio bind:this={player} src={url || undefined} preload="metadata" onplay={() => {playing=true; playbackState();}}
    onpause={() => {playing=false; playbackState();}} onended={ended}
    ontimeupdate={event => current=event.currentTarget.currentTime}
    ondurationchange={event => duration=Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0}
    onerror={() => {if (url) error='Этот браузер не смог воспроизвести файл.';}}></audio>
  <button class="mini-step" onclick={() => step(-1)} disabled={disabled || !selected} aria-label={$i18n.text("Предыдущий трек")}><ChatIcon name="previous" /></button>
  {@render playButton()}
  <button class="mini-step" onclick={() => step(1)} disabled={disabled || !adjacentAudio(ids,id,1,repeat==='all')} aria-label={$i18n.text("Следующий трек")}><ChatIcon name="next" /></button>
  <div class="track"><strong title={selected?.name}>{selected?.name || $i18n.text("Аудиофайл")}</strong>
    {#if loading}<small role="status">{$i18n.text("Подготавливаем аудио…")}</small>
    {:else if error}<small role="status">{$i18n.text(error)}</small>
    {:else}<div class="timeline"><input type="range" min="0" max={duration || 0} step="0.1" value={current} disabled={!duration}
      aria-label={$i18n.text("Позиция воспроизведения")} aria-valuetext={clock(current)+' '+$i18n.text('из')+' '+clock(duration)} oninput={event=>seek(Number(event.currentTarget.value))} /><small>{clock(current)} / {clock(duration)}</small></div>{/if}
  </div>
  <button onclick={() => queueOpen=true} aria-label={$i18n.text("Открыть очередь и настройки плеера:")+tracks.length+$i18n.text("треков")} title={$i18n.text("Очередь и настройки")}><ChatIcon name="queue" /></button>
  <button onclick={onClose} aria-label={$i18n.text("Остановить и закрыть аудиоплеер")} title={$i18n.text("Остановить и закрыть")}><ChatIcon name="close" /></button>
</section>
{#if queueOpen}
  <CompactDialog title={menuTrack ? menuView === 'info' ? $i18n.text("Информация о файле") : menuView === 'share' ? $i18n.text("Поделиться") : $i18n.text("Действия с треком") : $i18n.text("Очередь воспроизведения")} onClose={() => dismissOverlay()}>
    <div class="queue-panel">
      {#if menuTrack}
        <p class="filename"><strong>{menuTrack.name}</strong></p>
        {#if menuView === 'info'}
          <dl><dt>{$i18n.text("Название")}</dt><dd>{menuTrack.name}</dd><dt>{$i18n.text("Формат")}</dt><dd>{menuTrack.mime || $i18n.text("Не указан")}</dd>
            <dt>{$i18n.text("Размер")}</dt><dd>{$i18n("m_b28120b84d93", {v0: ($i18n.system(formatBytes(menuTrack.size))), v1: (menuTrack.size.toLocaleString($uiLocale))})}</dd>
            <dt>{$i18n.text("Дата сообщения")}</dt><dd>{new Date(menuTrack.timestamp).toLocaleString($uiLocale)}</dd>
            <dt>{$i18n.text("Отправитель")}</dt><dd>{menuTrack.sender}<small>{menuTrack.senderAddress}</small></dd></dl>
          <button class="wide" onclick={() => menuView='menu'}>{$i18n.text("← К действиям")}</button>
        {:else if menuView === 'share'}
          <p>{$i18n.text("Выбранное приложение получит копию файла вне защищённого чата.")}</p>
          {#if shareBusy}<p role="status">{$i18n.text("Проверяем файл…")}</p>
          {:else if shareFile && canShare()}<button class="wide" disabled={disabled} onclick={() => void share()}><ChatIcon name="share" />{$i18n.text("Поделиться файлом")}</button>
          {:else if shareFile}<p>{$i18n.text("Браузер не поддерживает отправку такого файла. Можно скачать его.")}</p>{/if}
          {#if shareError}<p role="status">{$i18n.text(shareError)}</p>{/if}
          <button class="wide" disabled={disabled} onclick={() => run('download')}><ChatIcon name="download" />{$i18n.text("Скачать")}</button>
          <button class="wide" onclick={() => {shareRequest++; shareBusy=false; menuView='menu';}}>{$i18n.text("← К действиям")}</button>
        {:else}
          <div class="track-actions">
            <button disabled={disabled} onclick={() => run('download')}><ChatIcon name="download" />{$i18n.text("Скачать")}</button>
            <button disabled={disabled} onclick={() => run('forward')}><ChatIcon name="forward" />{$i18n.text("Переслать")}</button>
            <button disabled={disabled} onclick={() => void prepareShare()}><ChatIcon name="share" />{$i18n.text("Поделиться")}</button>
            <button disabled={disabled} onclick={() => run('show-in-chat')}><ChatIcon name="chat" />{$i18n.text("Показать в чате")}</button>
            <button onclick={() => menuView='info'}><ChatIcon name="info" />{$i18n.text("О файле")}</button>
          </div>
        {/if}
      {:else}
        <div class="transport">
          <button class="mode-button" class:enabled={repeat !== 'none'} onclick={cycleRepeat} disabled={disabled}
            aria-label={$i18n.text("Повтор:")+$i18n.text(repeatLabel)+$i18n.text(". Переключить режим повтора")} aria-pressed={repeat !== 'none'} title={$i18n.text(repeatLabel)}>
            <ChatIcon name={repeat === 'one' ? 'repeat-one' : 'repeat'} />
          </button>
          <div class="transport-main">
            <button onclick={() => step(-1)} disabled={disabled || !selected} aria-label={$i18n.text("Предыдущий трек")}><ChatIcon name="previous" /></button>
            {@render playButton()}
            <button onclick={() => step(1)} disabled={disabled || !adjacentAudio(ids,id,1,repeat==='all')} aria-label={$i18n.text("Следующий трек")}><ChatIcon name="next" /></button>
          </div>
          <button class="mode-button" class:enabled={order === 'shuffle'} onclick={cycleOrder} disabled={disabled}
            aria-label={$i18n.text("Порядок:")+$i18n.text(orderLabel)+$i18n.text(". Переключить порядок")} title={$i18n.text(orderLabel)}>
            <ChatIcon name={order === 'reverse' ? 'order-down' : order === 'forward' ? 'order-up' : 'shuffle'} />
          </button>
        </div>
        <div class="queue-timeline">
          <input type="range" min="0" max={duration || 0} step="0.1" value={current} disabled={loading || !duration}
            aria-label={$i18n.text("Позиция воспроизведения в очереди")} aria-valuetext={clock(current)+' '+$i18n.text('из')+' '+clock(duration)} oninput={event => seek(Number(event.currentTarget.value))} />
          <div class="queue-times"><span>{clock(current)}</span><span>{ids.indexOf(id)+1} / {tracks.length}</span><span>{clock(duration)}</span></div>
          {#if loading || error}<small role="status">{loading ? $i18n.text("Подготавливаем аудио…") : $i18n.text(error)}</small>{/if}
        </div>
        <div class="volume"><button onclick={toggleMute} aria-label={muted?$i18n.text("Включить звук"):$i18n.text("Выключить звук")}><ChatIcon name={muted?'muted':'volume'} /></button>
          <input type="range" min="0" max="1" step="0.01" value={volume} disabled={volumeUnsupported} aria-label={$i18n.text("Громкость")} aria-valuetext={Math.round(volume*100)+'%'} oninput={event=>setVolume(Number(event.currentTarget.value))} /><small>{muted?$i18n.text("Без звука"):Math.round(volume*100)+'%'}</small></div>
        {#if volumeUnsupported}<small>{$i18n.text("Громкость регулируется кнопками устройства.")}</small>{/if}
        <ol class="queue">
          {#each orderedTracks as track, index (track.id)}
            <li class:current={track.id===id}>
              <button class="track-select" disabled={disabled || pauseForVideo} aria-current={track.id===id?'true':undefined} onclick={() => {if(track.id===id) toggle(); else onSelect(track.id);}}>
                <span>{track.id===id && playing?'♫':index+1}</span><span>{track.name}<small>{$i18n.system(formatBytes(track.size))}</small></span>
              </button>
              <button onclick={() => openMenu(track.id)} aria-label={$i18n.text("Действия:")+track.name}>⋯</button>
            </li>
          {/each}
        </ol>
        <small>{$i18n.text("Только полученные аудиофайлы этого чата. Голосовые сообщения — отдельно.")}</small>
      {/if}
    </div>
  </CompactDialog>
{/if}
<style>
  .audio-bar { flex-shrink:0; display:flex; align-items:center; gap:6px; padding:6px 8px; margin:0 0 8px; border:1px solid var(--line,#cbdcde); border-radius:12px; background:var(--accent-soft,#e4f3ef); }
  audio { display:none; } button { display:grid; place-items:center; padding:6px; width:36px; height:40px; min-width:36px; min-height:40px; border:0; background:transparent; color:inherit; }
  .play { color:var(--accent,#176b63); } .track { flex:1; min-width:0; } .track strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }
  .timeline { display:flex; align-items:center; gap:8px; } input[type="range"] { flex:1; min-width:0; width:100%; padding:0; margin:0; height:22px; accent-color:var(--accent,#176b63); }
  small { font-size:11px; color:var(--muted,#536b77); } .timeline small { white-space:nowrap; }
  .queue-panel { font-size:14px; }
  .transport { display:grid; grid-template-columns:44px minmax(0,1fr) 44px; align-items:center; gap:4px; margin:8px 0 4px; }
  .transport-main { display:flex; align-items:center; justify-content:center; gap:4px; }
  .transport button { width:44px; height:44px; min-width:44px; min-height:44px; }
  .mode-button { color:var(--muted,#536b77); }
  .mode-button.enabled { color:var(--success); }
  .queue-timeline { margin:4px 0 12px; }
  .queue-timeline input { display:block; height:24px; }
  .queue-times { display:flex; align-items:center; justify-content:space-between; gap:8px; font-size:11px; color:var(--muted,#536b77); font-variant-numeric:tabular-nums; }
  .volume { display:flex; align-items:center; gap:8px; margin:8px 0; }
  .queue { list-style:none; padding:0; margin:14px 0; max-height:45dvh; overflow:auto; }
  .queue li { display:flex; align-items:center; gap:4px; border:1px solid transparent; border-radius:10px; margin:3px 0; } .queue li.current { background:var(--accent-soft); border-color:var(--line); }
  button.track-select { flex:1; width:auto; height:auto; min-height:48px; display:flex; align-items:center; gap:10px; text-align:left; min-width:0; } .track-select>span:first-child { width:22px; flex-shrink:0; text-align:center; } .track-select>span:last-child { overflow-wrap:anywhere; min-width:0; } .track-select small,dd small { display:block; }
  .track-actions { display:grid; gap:6px; } .track-actions button,button.wide { display:flex; justify-content:flex-start; gap:10px; width:100%; height:auto; min-height:44px; padding:8px; border:1px solid var(--line); border-radius:10px; font-size:14px; } button.wide { margin-top:8px; }
  .filename,dd { overflow-wrap:anywhere; } dl { margin:12px 0; } dt { margin-top:12px; color:var(--muted); font-size:12px; } dd { margin:3px 0; }
  @media(max-width:500px) { .audio-bar .mini-step { display:none; } .audio-bar { gap:4px; padding:4px; } .timeline small { font-size:10px; } }
  @media(max-width:350px) { .transport { grid-template-columns:40px minmax(0,1fr) 40px; gap:2px; } .transport-main { gap:0; } .transport button { width:40px; min-width:40px; } }
</style>
