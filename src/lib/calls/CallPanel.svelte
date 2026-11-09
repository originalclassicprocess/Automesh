<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import Avatar from '$lib/chat/Avatar.svelte';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import { callLabel, callTime } from './presentation';
  import { startRingtone } from './ringtone';
  import type { CallView } from './controller';
  import AudioOutput from './AudioOutput.svelte';
  import { systemOutput } from './audio-output';
  let { view, name, photo = '', stream, onAccept, onEnd, onMismatch = onEnd, onMute, onDismiss, onChat }:
    { view: CallView; name: string; photo?: string; stream: MediaStream | null; onAccept(): void; onEnd(): void; onMismatch?(): void; onMute(): void; onDismiss(): void; onChat(): void } = $props();
  let expanded = $state(false), checking = $state(false), matched = $state(false), qr = $state('');
  let copied = $state(false), copyError = $state(false);
  let audio = $state<HTMLAudioElement>(), playbackBlocked = $state(false), mounted = $state(false), now = $state(0);
  let seenId = '', qrGeneration = 0;
  let soundMuted = $state(false), outputLabel = $state(systemOutput), outputSink = $state('');
  const duration = $derived(view.started ? callTime(view.started, view.ended || now) : '');
  const label = $derived(callLabel(view));
  const live = $derived(view.phase !== 'ended' && view.phase !== 'idle');
  onMount(() => {
    mounted = true; now = Date.now();
    return () => { mounted = false; if (audio) { audio.pause(); audio.srcObject = null; } };
  });
  $effect(() => {
    if (!mounted || !view.started || view.ended) return;
    now = Date.now(); const clock = setInterval(() => now = Date.now(), 1000);
    return () => clearInterval(clock);
  });
  $effect(() => {
    if (view.id !== seenId) { seenId = view.id; expanded = !!view.id; checking = false; matched = false; soundMuted = false; outputLabel = systemOutput; outputSink = ''; }
  });
  $effect(() => { if (mounted && view.phase === 'incoming') return startRingtone(); });
  $effect(() => {
    const code = view.code; const request = ++qrGeneration; qr = '';
    if (code && mounted) void QRCode.toDataURL(`automesh-call-check-v1:${code.replaceAll(' ', '')}`, { width: 180, margin: 2 })
      .then(value => { if (mounted && request === qrGeneration) qr = value; }).catch(() => {});
  });
  async function play() {
    if (!audio || !stream || !view.authenticated) return;
    const expected = stream;
    try { await audio.play(); if (stream === expected) playbackBlocked = false; }
    catch { if (stream === expected) playbackBlocked = true; }
  }
  $effect(() => {
    if (!mounted || !audio) return;
    const active = view.authenticated ? stream : null;
    audio.srcObject = active;
    if (active) void play(); else { audio.pause(); playbackBlocked = false; }
    const element = audio;
    return () => { element.pause(); element.srcObject = null; };
  });
  function close() { if (view.phase === 'incoming') onEnd(); else if (!live) onDismiss(); expanded = false; }
  async function copyCode() {
    const code = view.code;
    try { await navigator.clipboard.writeText(code); if (view.code === code) { copied = true; copyError = false; } }
    catch { copyError = true; }
  }
</script>
{#key view.id}
  <!-- svelte-ignore a11y_media_has_caption -->
  <audio bind:this={audio} autoplay muted={soundMuted} aria-label={$i18n.text("Звук собеседника")}></audio>
{/key}
{#if view.phase !== 'idle'}
  <section class="call-strip" class:incoming={view.phase === 'incoming'} aria-label={$i18n.text("Текущий звонок")}>
    <button class="summary" onclick={() => expanded = true} aria-label={$i18n("m_dd7fa3e4f16c", {v0: (name)})}>
      <ChatIcon name="phone" /><span><strong>{name}</strong><small>{$i18n.text(label)}{duration ? ` · ${duration}` : ''}</small></span>
    </button>
    {#if view.phase === 'incoming'}<button class="accept" onclick={onAccept} aria-label={$i18n.text("Принять звонок")}><ChatIcon name="phone" /></button>{/if}
    {#if live}<button class="hangup" onclick={onEnd} aria-label={view.phase === 'incoming' ? $i18n.text("Отклонить звонок") : $i18n.text("Завершить звонок")}><ChatIcon name="hangup" /></button>
    {:else}<button onclick={onDismiss} aria-label={$i18n.text("Скрыть завершённый звонок")}><ChatIcon name="close" /></button>{/if}
  </section>
  {#if expanded}
    <CompactDialog title={view.phase === 'incoming' ? $i18n.text("Входящий звонок") : $i18n.text("Голосовой звонок")} onClose={close}>
      <div class="call-card">
        <Avatar accountId={view.peer} {photo} size={88} />
        <h3>{name}</h3><p role="status" aria-live="polite">{$i18n.text(label)}</p>
        {#if duration}<div class="duration" aria-label={$i18n.text("Длительность звонка")}>{duration}</div>{/if}
        {#if view.authenticated}<div class="security"><ChatIcon name="shield" /><span>{$i18n.text("Аудиоканал зашифрован")}<br /><small>{$i18n.text("Привязка к аккаунту проверена")}</small></span></div>{/if}
        {#if view.reason === 'network'}<p class="hint">{$i18n.text("Прямое соединение не установлено или оборвалось. Резерв через TURN пока не подключён.")}</p>{/if}
        {#if view.reason === 'microphone'}<p class="hint">{view.endedByPeer ? $i18n.text("Собеседнику не удалось включить микрофон. Нужно проверить разрешение на его устройстве.") : $i18n.text("Разрешите микрофон для этого сайта в браузере, затем попробуйте снова.")}</p>{/if}
        {#if view.reason === 'security'}<p class="hint">{$i18n.text("Передача звука остановлена. Не продолжайте разговор до проверки соединения.")}</p>{/if}
        {#if view.phase === 'ended' && ['network', 'microphone', 'security'].includes(view.reason ?? '')}
          <small>{$i18n("m_4b5da31a1338", {v0: ({ permission: $i18n.text("разрешение микрофона"), invite: $i18n.text("приглашение"), offer: $i18n.text("предложение соединения"), answer: $i18n.text("ответ на соединение"), ice: $i18n.text("аудиосоединение"), active: $i18n.text("разговор") }[view.stage]), v1: (view.failure ? ` · ${view.failure}` : '')})}</small>
        {/if}
        {#if view.phase === 'outgoing' && view.stage === 'permission'}<p class="hint">{$i18n.text("Разрешите микрофон, чтобы начать вызов. Звук не передаётся до проверки защищённого соединения.")}</p>{/if}
        {#if view.phase === 'incoming'}<p class="hint">{$i18n.text("Микрофон включится после принятия. Для звонка держите оба приложения открытыми.")}</p>{/if}
        {#if playbackBlocked}<button class="accept" onclick={() => void play()}><ChatIcon name="volume" /> {$i18n.text("Включить звук собеседника")}</button>{/if}
        <div class="controls">
          {#if view.phase === 'incoming'}<button class="control accept" onclick={onAccept}><ChatIcon name="phone" /><span>{$i18n.text("Принять")}</span></button>{/if}
          {#if view.phase === 'active' || view.phase === 'reconnecting'}<button class="control" aria-label={view.muted ? $i18n.text("Включить микрофон") : $i18n.text("Выключить микрофон")} aria-pressed={view.muted} onclick={onMute}><ChatIcon name={view.muted ? 'mic-off' : 'microphone'} /><span>{$i18n.text("Микрофон")}<small>{view.muted ? $i18n.text("Выкл.") : $i18n.text("Вкл.")}</small></span></button>{/if}
          {#if view.phase === 'active' || view.phase === 'reconnecting'}<button class="control" aria-label={soundMuted ? $i18n.text("Включить звук") : $i18n.text("Выключить звук")} aria-pressed={soundMuted} onclick={() => { soundMuted = !soundMuted; if (!soundMuted) void play(); }}><ChatIcon name={soundMuted ? 'muted' : 'volume'} /><span>{$i18n.text("Звук")}<small>{soundMuted ? $i18n.text("Выкл.") : $i18n.text("Вкл.")}</small></span></button>{/if}
          {#if live}<button class="control hangup" onclick={onEnd}><ChatIcon name="hangup" /><span>{view.phase === 'incoming' ? $i18n.text("Отклонить") : $i18n.text("Завершить")}</span></button>{/if}
        </div>
        {#if view.phase === 'active' || view.phase === 'reconnecting'}
          <AudioOutput {audio} active={live && view.authenticated} bind:label={outputLabel} bind:selected={outputSink} />
          {#if soundMuted}<small role="status">{$i18n.text("Вы не слышите собеседника. Ваш микрофон управляется отдельно.")}</small>{/if}
        {/if}
        {#if view.authenticated && view.code}
          <button class="verification" onclick={() => checking = !checking} aria-expanded={checking}><ChatIcon name="shield" />{matched ? $i18n.text("Код сравнен вами") : $i18n.text("Проверить звонок")}</button>
          {#if checking}
            <section class="check" aria-label={$i18n.text("Проверка звонка")}>
              <p>{$i18n.text("Сравните все группы кода на обоих устройствах — лично или через другой доверенный канал.")}</p>
              <code>{view.code}</code>
              <button onclick={() => void copyCode()}>{copied ? $i18n.text("Код скопирован") : $i18n.text("Копировать код")}</button>
              {#if copyError}<small>{$i18n.text("Не удалось скопировать. Код можно выделить вручную.")}</small>{/if}
              {#if qr}<img src={qr} alt={$i18n.text("QR проверочного кода текущего звонка")} width="180" height="180" />{/if}
              <small>{$i18n.text("QR содержит тот же код, не ключ. Код меняется при новом звонке. Совпадение не защищает от записи собеседником или заражённого устройства.")}</small>
              <div class="check-actions"><button onclick={() => matched = true}>{$i18n.text("Коды совпадают")}</button><button onclick={onMismatch}>{$i18n.text("Не совпадают — завершить")}</button></div>
            </section>
          {/if}
        {/if}
        <button class="chat-link" onclick={() => { expanded = false; onChat(); }}><ChatIcon name="chat" /> {$i18n.text("Перейти в чат")}</button>
        {#if live && view.phase !== 'incoming'}<small>{$i18n.text("Можно свернуть окно. Блокировка аккаунта завершает звонок.")}</small>{/if}
      </div>
    </CompactDialog>
  {/if}
{/if}
<style>
  .call-strip { display:flex; align-items:center; gap:8px; flex-shrink:0; background:var(--accent-soft); border:1px solid var(--accent-line); border-radius:14px; padding:8px; margin-bottom:10px; }
  .summary { display:flex; align-items:center; gap:10px; text-align:left; flex:1; min-width:0; border:0; background:transparent; }
  .summary span { min-width:0; } strong, .summary small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .call-strip > button:not(.summary) { display:grid; place-items:center; width:44px; height:44px; border-radius:50%; flex-shrink:0; padding:8px; }
  .call-card { display:flex; flex-direction:column; align-items:center; text-align:center; gap:12px; padding:12px 0; }
  h3 { margin:0; overflow-wrap:anywhere; max-width:100%; } p { margin:0; } small, .hint { color:var(--muted); font-size:13px; line-height:1.55; }
  .duration { font-variant-numeric:tabular-nums; font-size:30px; letter-spacing:.02em; }
  .security { display:flex; gap:8px; align-items:center; padding:10px 14px; border-radius:12px; color:var(--accent); background:var(--accent-soft); font-size:14px; }
  .controls { display:flex; align-items:stretch; justify-content:center; gap:8px; width:100%; margin:6px 0; }
  .control { display:flex; flex-direction:column; gap:6px; align-items:center; justify-content:center; min-height:84px; flex:1; min-width:0; max-width:180px; border-radius:18px; font-size:12px; padding:10px 4px; }
  .control small { display:block; font-size:11px; } .control[aria-pressed='true'] { background:var(--surface-alt); color:var(--muted); }
  .accept { background:var(--accent); border-color:var(--accent); color:var(--on-accent); } .accept:hover:not(:disabled) { background:var(--accent-hover); }
  .hangup { background:var(--danger); border-color:var(--danger); color:var(--on-accent); } .hangup:hover:not(:disabled) { background:var(--danger-hover); }
  .verification, .chat-link { display:flex; gap:8px; align-items:center; justify-content:center; }
  .check { display:flex; flex-direction:column; align-items:center; gap:12px; background:var(--surface-alt); border:1px solid var(--line); padding:14px; border-radius:14px; width:100%; box-sizing:border-box; }
  .check p { font-size:14px; } code { font-size:16px; line-height:1.8; word-spacing:.3em; overflow-wrap:anywhere; user-select:all; }
  .check-actions { display:flex; gap:8px; flex-wrap:wrap; justify-content:center; } .check-actions button { font-size:13px; min-height:44px; }
</style>
