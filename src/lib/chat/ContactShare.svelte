<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import AccountQr from '$lib/application/AccountQr.svelte';
  import ChatIcon from './ChatIcon.svelte';
  import {identiconFor} from '$lib/addressing/identicon';
  let {accountId,contactUrl='',qr='',copied=false,onCopy,onShare,sharing=false,showPattern=false}: {
    accountId:string;contactUrl?:string;qr?:string;copied?:boolean;onCopy():void;onShare?:()=>void;sharing?:boolean;showPattern?:boolean
  }=$props();
</script>
<section class="contact-share" aria-label={$i18n.text("Контакт и QR")}>
  <div class="id-label">Mesh ID</div>
  <div class="id-row address-line">
    {#if showPattern}<img src={identiconFor(accountId)} alt={$i18n.text("Пиксельный узор адреса")} width="28" height="28" />{/if}
    <code>{accountId}</code>
    <button class="copy-id" type="button" onclick={onCopy} aria-label={copied?$i18n.text("Mesh ID скопирован"):$i18n.text("Скопировать Mesh ID")} title={copied?$i18n.text("Скопировано"):$i18n.text("Скопировать только Mesh ID")}>
      {#if copied}<span aria-hidden="true">✓</span>{:else}<ChatIcon name="copy" />{/if}
    </button>
  </div>
  <AccountQr {accountId} {contactUrl} value={qr} />
  {#if onShare}<button class="share-link" type="button" onclick={onShare} disabled={sharing}><ChatIcon name="share" />{sharing?$i18n.text("Подождите…"):$i18n.text("Поделиться контактом")}</button>{/if}
  <p class="hint">{$i18n.text("Для добавления в контакты. Этот QR не выдаёт доступ к аккаунту.")}</p>
</section>
<style>
  .contact-share{min-width:0}.id-label{font-size:12px;color:var(--muted);margin-bottom:6px}.id-row{display:flex;gap:8px;align-items:center;min-width:0}
  code{min-width:0;flex:1;overflow-wrap:anywhere;user-select:text;font-size:12px;line-height:1.6;font-weight:500}.copy-id{flex:0 0 40px;display:grid;place-items:center;width:40px;min-height:40px;padding:7px}
  .id-row img{flex-shrink:0;image-rendering:pixelated}
  .share-link{display:flex;justify-content:center;align-items:center;gap:8px;width:100%;min-height:40px;font-size:14px;padding:8px 12px}
  .hint{font-size:12px;line-height:1.5;color:var(--muted);margin:10px 0 0}
</style>
