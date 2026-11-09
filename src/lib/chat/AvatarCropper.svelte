<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import { loadAvatarPhoto, type AvatarPhoto } from './avatar-browser';
  import { avatarCropRect, defaultAvatarCrop, moveAvatarCrop, type AvatarCrop } from './avatar-crop';
  import ChatIcon from './ChatIcon.svelte';
  let { file, onSave, onCancel }: { file: File; onSave(crop: AvatarCrop): void; onCancel(): void } = $props();
  let dialog: HTMLDialogElement, canvas: HTMLCanvasElement;
  let image = $state<AvatarPhoto | null>(null), error = $state('');
  let crop = $state(defaultAvatarCrop());
  let pointer: { id: number; x: number; y: number } | null = null;
  function draw() {
    if (!image || !canvas) return;
    const ctx = canvas.getContext('2d'); if (!ctx) { error = 'Не удалось открыть редактор фото.'; return; }
    const rect = avatarCropRect(image.width,image.height,crop);
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,320,320);
    ctx.drawImage(image.image,rect.x,rect.y,rect.size,rect.size,0,0,320,320);
  }
  $effect(() => { crop.zoom; crop.x; crop.y; image; draw(); });
  onMount(() => {
    dialog.showModal(); const abort = new AbortController();
    let photo: Awaited<ReturnType<typeof loadAvatarPhoto>> | undefined;
    void loadAvatarPhoto(file,abort.signal).then(value => {
      if (abort.signal.aborted) { value.dispose(); return; }
      photo = value; image = value;
    }).catch(reason => { if (!abort.signal.aborted) error = reason instanceof Error ? reason.message : 'Не удалось открыть фото.'; });
    return () => { abort.abort(); photo?.dispose(); canvas.width = 0; canvas.height = 0; dialog.close(); };
  });
  function start(event: PointerEvent) {
    if (!image || pointer || event.button !== 0) return;
    pointer = { id:event.pointerId, x:event.clientX, y:event.clientY }; canvas.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent) {
    if (!image || pointer?.id !== event.pointerId) return;
    crop = moveAvatarCrop(image.width,image.height,crop,event.clientX-pointer.x,event.clientY-pointer.y,canvas.getBoundingClientRect().width);
    pointer = { id:event.pointerId,x:event.clientX,y:event.clientY };
  }
  function end(event: PointerEvent) { if (pointer?.id === event.pointerId) { pointer = null; if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); } }
</script>
<dialog bind:this={dialog} aria-label={$i18n.text("Фото профиля")} oncancel={event => { event.preventDefault(); onCancel(); }}>
  <header><h3>{$i18n.text("Фото профиля")}</h3><button type="button" onclick={onCancel} aria-label={$i18n.text("Закрыть")}><ChatIcon name="close" /></button></header>
  <div class="preview">
    <canvas bind:this={canvas} width="320" height="320" aria-label={$i18n.text("Превью аватара: фото можно перемещать пальцем или мышью")}
      onpointerdown={start} onpointermove={move} onpointerup={end} onpointercancel={end} onlostpointercapture={() => pointer = null}></canvas>
    {#if !image && !error}<span role="status">{$i18n.text("Открываем фото…")}</span>{/if}
  </div>
  {#if error}<p role="alert">{$i18n.text(error)}</p>{:else}
    <small>{$i18n.text("Переместите фото и выберите масштаб")}</small>
    <label>{$i18n.text("Масштаб")}<input type="range" min="1" max="4" step="0.05" bind:value={crop.zoom} disabled={!image} /></label>
    <details><summary>{$i18n.text("Положение фото")}</summary>
      <label>{$i18n.text("По горизонтали")}<input type="range" min="0" max="1" step="0.01" bind:value={crop.x} disabled={!image} /></label>
      <label>{$i18n.text("По вертикали")}<input type="range" min="0" max="1" step="0.01" bind:value={crop.y} disabled={!image} /></label>
    </details>
  {/if}
  <footer><button type="button" onclick={() => crop = defaultAvatarCrop()} disabled={!image}>{$i18n.text("Сбросить")}</button>
    <button type="button" onclick={() => onSave({ ...crop })} disabled={!image || !!error}>{$i18n.text("Сохранить")}</button></footer>
</dialog>
<style>
  dialog { width:min(400px,calc(100vw - 24px)); max-height:calc(100dvh - 24px); overflow:auto; box-sizing:border-box; padding:16px; border:1px solid var(--line); border-radius:18px; background:var(--surface); color:var(--text); }
  dialog::backdrop { background:var(--overlay); } header, footer { display:flex; align-items:center; gap:8px; justify-content:space-between; } h3 { margin:0; font-size:18px; } header button { display:grid; place-items:center; padding:8px; }
  .preview { position:relative; max-width:320px; margin:14px auto; aspect-ratio:1; border-radius:24%; overflow:hidden; background:var(--surface-alt); }
  canvas { display:block; width:100%; height:100%; touch-action:none; cursor:grab; } canvas:active { cursor:grabbing; } .preview span { position:absolute; inset:0; display:grid; place-items:center; }
  label { display:flex; align-items:center; gap:10px; font-size:13px; margin:12px 0; } input { flex:1; min-width:0; } small, summary { color:var(--muted); font-size:12px; } footer { margin-top:16px; } footer button { flex:1; } p { font-size:13px; }
</style>
