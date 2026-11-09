<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  let { files, disabled, onRemove }: { files: File[]; disabled: boolean; onRemove(index: number): void } = $props();
  let urls = $state<string[]>([]);
  $effect(() => {
    const created = files.map(file => URL.createObjectURL(file)); urls = created;
    return () => created.forEach(url => URL.revokeObjectURL(url));
  });
</script>
{#if files.length}
  <section class="pasted-images" aria-label={$i18n.text("Вложения к отправке")}>
    <small>{$i18n.text("Вложения отправятся после нажатия «Отправить». Удерживайте её для дополнительных настроек.")}</small>
    <div class="previews">{#each files as file, index}
      <article>{#if /^image\/(png|jpeg|gif|webp|avif)$/.test(file.type)}<img src={urls[index]} alt={file.name || $i18n.text("Вставленная картинка")} />{:else}<span>{file.name}<br /><small>{$i18n("m_23efda167fd1", {v0: ((file.size/1024).toFixed(1))})}</small></span>{/if}<button disabled={disabled} onclick={() => onRemove(index)} aria-label={$i18n("m_679b953757d0", {v0: (index + 1)})}>×</button></article>
    {/each}</div>
  </section>
{/if}
<style>
  .pasted-images { padding:10px; border:1px solid var(--line); border-radius:14px; margin:8px 0; }
  small { font-size:12px; color:var(--muted); } .previews { display:flex; gap:8px; overflow-x:auto; padding-top:8px; }
  article { position:relative; flex:0 0 86px; border-radius:12px; background:var(--surface-alt); }
  article span { display:block; padding:32px 6px 6px; font-size:12px; overflow-wrap:anywhere; }
  img { width:86px; height:86px; object-fit:contain; border-radius:12px; display:block; }
  button { position:absolute; right:0; top:0; border-radius:50%; width:32px; height:32px; padding:0; font-size:22px; }
</style>
