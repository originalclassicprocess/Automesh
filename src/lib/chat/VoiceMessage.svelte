<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount, untrack, type Snippet } from 'svelte';
  import { VoiceRecorder, type VoiceState } from './voice-recorder';
  import { createVoiceMeter } from './voice-meter';
  import ChatIcon from './ChatIcon.svelte';
  import NotificationToast from '$lib/application/NotificationToast.svelte';
  import type { AppNotice } from '$lib/application/notices';
  let { disabled = false, onFile, onBusy, onNotice, idle }: {
    disabled?: boolean; onFile(file:File):Promise<boolean>; onBusy(busy:boolean):void;
    onNotice?(notice:AppNotice|null):void; idle?:Snippet<[Snippet]>;
  } = $props();
  let voiceState = $state<VoiceState>({phase:'idle',seconds:0,level:0,notice:null,blob:null});
  let recorder = $state<VoiceRecorder>();
  let url = $state(''), audio = $state<HTMLAudioElement>();
  let previewBlob = $derived(voiceState.blob);
  $effect(() => {
    if (!previewBlob) { url = ''; return; }
    const next = URL.createObjectURL(previewBlob); url = next;
    return () => { audio?.pause(); URL.revokeObjectURL(next); };
  });
  onMount(() => {
    let previousNotice: AppNotice|null = null;
    recorder = new VoiceRecorder({
      getStream: () => navigator.mediaDevices.getUserMedia({audio:true,video:false}),
      supported: mime => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime),
      recorder: (stream,mimeType) => new MediaRecorder(stream,{mimeType,audioBitsPerSecond:64_000}),
      meter: createVoiceMeter,
    }, value => {
      voiceState = value; onBusy(value.phase !== 'idle');
      if (value.notice !== previousNotice) { previousNotice = value.notice; onNotice?.(value.notice); }
    }, async (blob,extension) => {
      if (!extension || disabled) return false;
      audio?.pause();
      return onFile(new File([blob], `voice-${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`,{type:blob.type.split(';')[0]}));
    });
    const hidden = () => { if (document.hidden) { audio?.pause(); recorder?.interrupt(); } };
    document.addEventListener('visibilitychange',hidden);
    return () => { recorder?.dispose(); audio?.pause(); onBusy(false); onNotice?.(null); document.removeEventListener('visibilitychange',hidden); };
  });
  // The parent's attachment flag becomes busy during our own confirmed send.
  $effect(() => {
    if (disabled && voiceState.phase !== 'idle' && voiceState.phase !== 'sending') untrack(() => recorder?.cancel());
  });
  function dismissNotice() { recorder?.clearNotice(); }
</script>
{#snippet microphone()}
  <button class="mic" type="button" onclick={() => void recorder?.start()} {disabled} aria-label={$i18n.text("Записать голосовое сообщение")} title={$i18n.text("Голосовое сообщение · до 5 минут")}><ChatIcon name="microphone" /></button>
{/snippet}
{#if voiceState.phase === 'idle'}
  {#if idle}{@render idle(microphone)}{:else}{@render microphone()}{/if}
{:else}
  <div class="voice-strip" aria-label={voiceState.phase === 'review' || voiceState.phase === 'sending' ? $i18n.text("Прослушивание голосового сообщения") : $i18n.text("Запись голосового сообщения")}>
    <button type="button" onclick={() => recorder?.cancel()} disabled={voiceState.phase === 'sending'} aria-label={$i18n.text("Удалить запись")} title={$i18n.text("Удалить запись")}><ChatIcon name="trash" /></button>
    {#if voiceState.phase === 'review' || voiceState.phase === 'sending'}
      <div class="review">
        {#if url}<audio bind:this={audio} src={url} controls preload="metadata" aria-label={$i18n.text("Прослушать запись")}
          onerror={() => { onNotice?.({message:'Не удалось прослушать запись. Её можно удалить или отправить.',durationMs:0,kind:'error'}); }}></audio>{/if}
      </div>
      <button class="primary" type="button" onclick={() => void recorder?.sendPreview()} disabled={disabled || voiceState.phase === 'sending'} aria-label={$i18n.text("Отправить голосовое сообщение")} title={$i18n.text("Отправить запись")} aria-busy={voiceState.phase === 'sending'}><ChatIcon name="send" /></button>
    {:else}
      <div class="recording">
        <span class="time" role="status">{#if voiceState.phase === 'requesting'}{$i18n.text("Микрофон…")}{:else}<i aria-hidden="true"></i>{Math.floor(voiceState.seconds/60)}:{String(voiceState.seconds%60).padStart(2,'0')}{/if}</span>
        {#if voiceState.phase === 'recording'}<meter min="0" max="1" value={voiceState.level} aria-label={$i18n.text("Уровень звука микрофона")}></meter>
        {:else if voiceState.phase === 'stopping'}<small>{$i18n.text("Готовим запись…")}</small>{/if}
      </div>
      {#if voiceState.phase === 'recording'}<button type="button" onclick={() => recorder?.stopForReview()} {disabled} aria-label={$i18n.text("Остановить запись и прослушать")} title={$i18n.text("Остановить и прослушать")}><ChatIcon name="stop" /></button>{/if}
    {/if}
  </div>
{/if}
{#if voiceState.notice && !onNotice}<div class="voice-toast"><NotificationToast notice={voiceState.notice} onClose={dismissNotice} /></div>{/if}
<style>
  .mic, .voice-strip > button { min-width:44px; width:44px; height:44px; min-height:44px; padding:6px; display:grid; place-items:center; flex-shrink:0; }
  .voice-strip { display:flex; align-items:center; gap:8px; margin-top:6px; width:100%; min-width:0; min-height:52px; box-sizing:border-box; padding:4px; border:1px solid var(--line); border-radius:12px; background:var(--surface); flex-shrink:0; }
  .recording, .review { flex:1; min-width:0; } .recording { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  .time { display:flex; align-items:center; gap:8px; font-size:14px; font-variant-numeric:tabular-nums; white-space:nowrap; }
  i { width:8px; height:8px; border-radius:50%; background:var(--danger); } meter { flex:1; min-width:30px; max-width:160px; height:18px; } small { font-size:12px; color:var(--muted); }
  .review audio { display:block; width:100%; min-width:0; height:44px; } .review { overflow:hidden; }
  .voice-toast { position:fixed; top:max(12px,env(safe-area-inset-top)); left:12px; right:12px; max-width:520px; margin:auto; z-index:100; }
</style>
