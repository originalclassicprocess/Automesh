<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  let { load }: { load: () => Promise<{ bytes: Uint8Array; mime: string }> } = $props();
  let host: HTMLSpanElement;
  let url = $state(''); let error = $state(false);
  onMount(() => {
    let canceled = false; let loading = false;
    const observer = new IntersectionObserver(entries => {
      if (loading || !entries.some(entry => entry.isIntersecting)) return;
      loading = true; observer.disconnect();
      void load().then(media => {
        if (!canceled) url = URL.createObjectURL(new Blob([media.bytes as BlobPart], { type: media.mime }));
      }).catch(() => { if (!canceled) error = true; });
    });
    observer.observe(host);
    return () => { canceled = true; observer.disconnect(); if (url) URL.revokeObjectURL(url); };
  });
</script>
<span bind:this={host} class="inline-audio">
  {#if url && !error}<audio controls preload="metadata" src={url} onerror={() => error = true} aria-label={$i18n.text("Аудиосообщение")}></audio>
  {:else if error}<small>{$i18n.text("Браузер не смог воспроизвести аудио. Можно скачать файл.")}</small>
  {:else}<small>{$i18n.text("Подготавливаем аудио…")}</small>{/if}
</span>
<style>.inline-audio { display:block; margin-top:6px; min-height:44px; } audio { max-width:100%; width:300px; } small { font-size:12px; }</style>
