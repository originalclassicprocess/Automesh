<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import { CallAudioOutput, outputUnavailable, systemOutput, type OutputDevice } from './audio-output';
  let { audio, active, label = $bindable(systemOutput), selected = $bindable('') }: { audio: HTMLAudioElement | undefined; active: boolean; label?: string; selected?: string } = $props();
  let opened = $state(false), supported = $state(false), chooser = $state(false), busy = $state(false);
  let devices = $state<OutputDevice[]>([]), message = $state('');
  let mounted = $state(false), controller: CallAudioOutput | undefined;
  let noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const notice = (text: string) => {
    clearTimeout(noticeTimer); message = text;
    noticeTimer = setTimeout(() => message = '', 7000);
  };
  onMount(() => { mounted = true; return () => { mounted = false; controller?.dispose(); clearTimeout(noticeTimer); }; });
  $effect(() => {
    if (!mounted || !audio) return;
    const element = audio;
    const media = navigator.mediaDevices as (MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> }) | undefined;
    const instance = new CallAudioOutput({ active: () => mounted && active && audio === element,
      sink: typeof element.setSinkId === 'function' ? id => element.setSinkId(id) : undefined,
      choose: typeof media?.selectAudioOutput === 'function' ? () => media.selectAudioOutput!() : undefined,
      enumerate: media ? () => media.enumerateDevices() : undefined });
    controller = instance; supported = instance.supported(); chooser = instance.canChoose();
    // A switch already handed to the browser may finish while the modal is
    // minimized. Re-read the actual sink rather than claiming the old output.
    if (element.sinkId !== undefined && element.sinkId !== selected) {
      selected = element.sinkId; label = selected ? 'Выбранный аудиовыход' : systemOutput;
    }
    const changed = () => { if (active) void refresh(true); };
    media?.addEventListener('devicechange', changed);
    return () => { media?.removeEventListener('devicechange', changed); instance.dispose(); if (controller === instance) controller = undefined; };
  });
  $effect(() => { if (!active) { opened = false; message = ''; clearTimeout(noticeTimer); } });
  async function refresh(checkDisconnected = false) {
    const current = controller;
    const values = await current?.list();
    if (controller === current && active) {
      devices = values ?? [];
      if (checkDisconnected && selected && !devices.some(device => device.deviceId === selected))
        notice('Выбранный выход отключён или недоступен. Выберите другой. Автоматически включать динамик не будем.');
    }
  }
  async function open() { opened = !opened; if (opened && supported) await refresh(); }
  async function select(id?: string) {
    const current = controller;
    if (!current || !active || busy) return;
    busy = true;
    const result = await current.select(id);
    if (controller === current && active && result) {
      if (result.ok) { label = result.label; selected = audio?.sinkId ?? ''; opened = false; message = ''; clearTimeout(noticeTimer); }
      else notice(result.message);
    }
    busy = false;
  }
</script>
<section class="audio-output" aria-label={$i18n.text("Аудиовыход звонка")}>
  <button class="output-button" onclick={() => void open()} disabled={!active || busy} aria-expanded={opened}>
    <ChatIcon name="volume" /><span>{$i18n.text("Аудиовыход")}<small>{$i18n.text(label)}</small></span>
  </button>
  {#if opened}
    <div class="output-options">
      {#if supported}
        <button onclick={() => void select('')} disabled={busy}>{$i18n.text("Как настроено на устройстве")}</button>
        {#if chooser}<button onclick={() => void select()} disabled={busy}>{$i18n.text("Выбрать аудиоустройство…")}</button>
        {:else}
          {#each devices as device (device.deviceId)}<button onclick={() => void select(device.deviceId)} disabled={busy}>{device.label}</button>{/each}
          <button onclick={() => void refresh()} disabled={busy}>{$i18n.text("Обновить список выходов")}</button>
          {#if !devices.length}<small>{$i18n.text("Другие выходы не предоставлены браузером. Подключите гарнитуру или измените выход в настройках устройства.")}</small>{/if}
        {/if}
        <small>{$i18n.text("Доступны только выходы, разрешённые браузером. Разговорный динамик телефона может отсутствовать в списке.")}</small>
      {:else}<small>{$i18n.text(outputUnavailable)}</small>{/if}
    </div>
  {/if}
  {#if message}<small class="notice" role="status">{$i18n.text(message)}</small>{/if}
</section>
<style>
  .audio-output { width:100%; max-width:380px; }
  .output-button { display:flex; align-items:center; justify-content:center; gap:10px; width:100%; min-height:48px; border-radius:14px; }
  .output-button span { min-width:0; overflow-wrap:anywhere; } .output-button small { display:block; }
  .output-options { display:flex; flex-direction:column; gap:8px; border:1px solid var(--line); background:var(--surface-alt); padding:12px; border-radius:14px; margin-top:8px; }
  .output-options button { min-height:44px; border-radius:12px; overflow-wrap:anywhere; }
  small { color:var(--muted); font-size:12px; line-height:1.5; } .notice { display:block; margin-top:8px; }
</style>
