<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  let { load, autoplay = true }: { load: () => Promise<{ bytes: Uint8Array; mime: string }>; autoplay?: boolean } = $props();
  let host: HTMLSpanElement; let player = $state<HTMLVideoElement>();
  let url = $state(''); let error = $state(false); let visible = $state(false); let active = $state(true);
  let muted = $state(true); let played = $state(false); let attempted = false;
  onMount(() => {
    let canceled = false; let loading = false;
    const observer = new IntersectionObserver(entries => {
      visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.25);
      if (loading || !visible) return;
      loading = true;
      void load().then(media => {
        if (!canceled) url = URL.createObjectURL(new Blob([media.bytes as BlobPart], { type: media.mime }));
      }).catch(() => { if (!canceled) error = true; });
    }, { threshold: [0, 0.25] });
    const changed = () => { active = !document.hidden; };
    changed(); observer.observe(host); document.addEventListener('visibilitychange', changed);
    return () => { canceled = true; observer.disconnect(); document.removeEventListener('visibilitychange', changed);
      player?.pause(); if (url) URL.revokeObjectURL(url); };
  });
  $effect(() => {
    if (!player || !url) return;
    if (!visible || !active || !autoplay) { player.pause(); return; }
    if (autoplay && !attempted) {
      attempted = true; player.muted = true;
      void player.play().catch(() => {}); // Browsers may require a user gesture.
    }
  });
</script>
<span bind:this={host} class="inline-video">
  {#if url && !error}
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={player} controls playsinline preload="metadata" bind:muted src={url}
      onplaying={() => played = true} onerror={() => error = true} aria-label={$i18n.text("Видео в чате")}></video>
    {#if played && muted}<button onclick={() => { muted = false; }}>{$i18n.text("Включить звук")}</button>{/if}
  {:else if error}<small>{$i18n.text("Браузер не смог воспроизвести видео. Можно скачать файл.")}</small>
  {:else}<small>{$i18n.text("Подготавливаем видео…")}</small>{/if}
</span>
<style>
  .inline-video { display:block; margin-top:8px; min-height:80px; width:440px; max-width:100%; }
  video { display:block; width:100%; max-height:440px; border-radius:10px; background:#16252b; }
  small { font-size:12px; }
  @media(max-width:700px) { video { max-height:55dvh; } }
</style>
