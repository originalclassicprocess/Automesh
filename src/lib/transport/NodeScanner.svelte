<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import { readQrFrame } from './qr-reader';
  let { onResult, onClose, continuous = false, label = 'Сканирование QR сервера',
    seenParts = [], partCount = 0, onResetProgress }: {
    onResult: (value: string) => void; onClose: () => void; continuous?: boolean; label?: string;
    seenParts?: number[]; partCount?: number; onResetProgress?: () => void
  } = $props();
  let video: HTMLVideoElement;
  let error = $state('');
  onMount(() => {
    let cancelled = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let previous = '';
    void (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('camera_unavailable');
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        if (cancelled) { media.getTracks().forEach((track) => track.stop()); return; }
        stream = media;
        video.srcObject = media;
        await video.play();
        if (cancelled) return;
        timer = setInterval(() => {
          if (document.hidden || cancelled) return;
          try {
            const text = readQrFrame(video, video.videoWidth, video.videoHeight);
            if (text && text !== previous) {
              previous = text;
              if (!continuous) { cancelled = true; clearInterval(timer); media.getTracks().forEach((track) => track.stop()); }
              onResult(text);
            }
          } catch { error = 'Не удалось прочитать кадр. Попробуйте QR из изображения.'; }
        }, 400);
      } catch {
        stream?.getTracks().forEach((track) => track.stop());
        if (!cancelled) error = 'Камера недоступна или доступ запрещён. Можно загрузить изображение QR.';
      }
    })();
    return () => { cancelled = true; if (timer) clearInterval(timer); stream?.getTracks().forEach((track) => track.stop()); };
  });
</script>

<div aria-label={$i18n.text(label)}>
  {#if continuous}
    <div class="scan-progress" aria-live="polite">
      <strong>{partCount ? $i18n("m_21f7edc03fcb", {v0: (seenParts.length), v1: (partCount)}) : $i18n.text("Наведите камеру на QR")}</strong>
      {#if partCount}
        <div class="indicators" aria-label={$i18n.text("Считанные части QR")}>
          {#each Array(partCount) as _, index}
            <span class:read={seenParts.includes(index + 1)} aria-label={$i18n("m_74efaafb1c4c", {v0: (index + 1), v1: (seenParts.includes(index + 1) ? $i18n.text("считана") : $i18n.text("ожидается"))})}>{index + 1}</span>
          {/each}
        </div>
        {#if onResetProgress}<button type="button" onclick={onResetProgress}>{$i18n.text("Сбросить части")}</button>{/if}
      {/if}
    </div>
  {/if}
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} autoplay muted playsinline style="width:100%; max-width:360px; background:#222;"></video>
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
  <button type="button" onclick={onClose}>{$i18n.text("Закрыть камеру")}</button>
</div>

<style>
  .scan-progress { max-width:360px; margin:8px 0; padding:8px; border:1px solid var(--line-strong); }
  .indicators { display:flex; flex-wrap:wrap; gap:6px; margin:7px 0; }
  .indicators span { display:inline-grid; place-items:center; width:28px; height:28px; border:1px solid var(--line-strong); border-radius:50%; }
  .indicators span.read { background:var(--success); color:var(--on-accent); border-color:var(--accent-line); }
</style>
