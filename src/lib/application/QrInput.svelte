<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import QrImageButton from './QrImageButton.svelte';
  let { value=$bindable(''),label,placeholder='Вставьте ссылку или содержимое QR',disabled=false,maxlength=4096,multiline=false,onInput=()=>{},onScan,onImage }: {
    value:string;label:string;placeholder?:string;disabled?:boolean;maxlength?:number;multiline?:boolean;onInput?():void;onScan():void;onImage(event:Event):void;
  }=$props();
  const uid=$props.id();
</script>
<div class="qr-input">
  <label for={`${uid}-text`}>{$i18n.text(label)}</label>
  {#if multiline}<textarea id={`${uid}-text`} bind:value rows="3" {maxlength} {disabled} placeholder={$i18n.text(placeholder)} spellcheck="false" autocomplete="off" oninput={onInput}></textarea>
  {:else}<input id={`${uid}-text`} bind:value {maxlength} {disabled} placeholder={$i18n.text(placeholder)} spellcheck="false" autocomplete="off" oninput={onInput} />{/if}
  <div class="qr-actions">
    <button type="button" {disabled} onclick={onScan}><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M7 12h10" /></svg>{$i18n.text("Сканировать QR")}</button>
    <QrImageButton {disabled} label={$i18n("m_1b6698d30a49", {v0: ($i18n.text(label))})} {onImage} />
  </div>
</div>
<style>
  .qr-input{width:100%;margin:12px 0}label{display:block;font-size:14px;font-weight:600;margin-bottom:6px}input,textarea{width:100%;box-sizing:border-box;min-width:0;font-size:15px;border-radius:14px}.qr-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.qr-actions button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px;box-sizing:border-box;padding:10px 14px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:inherit;font-size:14px;font-weight:500;cursor:pointer}svg{flex-shrink:0}
</style>
