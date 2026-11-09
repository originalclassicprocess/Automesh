<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  let {disabled=false,label='Выбрать изображение QR',onImage}:{disabled?:boolean;label?:string;onImage(event:Event):void}=$props();
  const uid=$props.id();
</script>
<label class="image-choice" class:disabled for={uid}>
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m4 17 5-5 4 4 3-3 5 5"/><circle cx="16" cy="8" r="1"/></svg>
  <span>{$i18n.text("Из изображения")}</span><input id={uid} type="file" accept="image/png,image/jpeg,image/webp" {disabled} aria-label={$i18n.text(label)} onchange={onImage} />
</label>
<style>
  .image-choice{position:relative;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;box-sizing:border-box;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface);color:inherit;font:inherit;font-size:14px;font-weight:500;line-height:1.25;cursor:pointer;max-width:100%;margin:0}
  input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}svg{flex-shrink:0}span{min-width:0;overflow-wrap:anywhere}.image-choice:focus-within{outline:3px solid var(--focus);outline-offset:3px}.image-choice:hover:not(.disabled){background:var(--surface-alt);border-color:var(--line-strong)}.disabled{opacity:.48;cursor:default}
</style>
