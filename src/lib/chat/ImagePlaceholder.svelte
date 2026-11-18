<script lang="ts">
  import {tr as i18n} from '$lib/i18n/language';
  import {normalizeImagePreview,type ImagePreview} from './image-preview';
  let {preview}:{preview:ImagePreview}=$props();
  const image=$derived(normalizeImagePreview(preview));
</script>
{#if image}
  <span class="image-placeholder" role="img" aria-label={`${$i18n.text('Предварительные цвета изображения')} · ${image.width} × ${image.height}`}
    style:width={`min(100%, ${Math.min(280,320*image.width/image.height)}px)`} style:aspect-ratio={`${image.width} / ${image.height}`}>
    {#if image.colors}<span class="colors" aria-hidden="true">{#each image.colors as color}<span style:background-color={color}></span>{/each}</span>{/if}
    <span class="dimensions">{image.width} × {image.height}</span>
  </span>
{/if}
<style>
  .image-placeholder{position:relative;display:block;overflow:hidden;max-width:100%;border:1px solid var(--line);border-radius:12px;background:var(--surface-alt);margin:5px 0;isolation:isolate}
  .colors{position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);filter:blur(15px);transform:scale(1.2);opacity:.8}
  .dimensions{position:absolute;bottom:6px;right:6px;padding:3px 6px;border-radius:7px;background:var(--surface);color:var(--muted);font-size:11px;font-variant-numeric:tabular-nums;opacity:.9}
</style>
