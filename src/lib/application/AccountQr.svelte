<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import QRCode from 'qrcode';
  import { isValidAccountId } from '../addressing/bech32m.js';
  let { accountId, value = '', label = 'QR-код моего Mesh ID', contactUrl = '' }: { accountId: string; value?: string; label?: string; contactUrl?: string } = $props();
  let generated = $state(''), error = $state('');
  let withRoute = $state(true);
  const routed=$derived(withRoute&&!!contactUrl);
  $effect(() => {
    const id = accountId; let current = true; generated = ''; error = '';
    const content = routed ? contactUrl : id;
    if ((routed || !value) && isValidAccountId(id)) void QRCode.toDataURL(content, { width: 256, margin: 2 }).then(qr => { if (current) generated = qr; })
      .catch(() => { if (current) error = 'Не удалось построить QR. Можно скопировать Mesh ID.'; });
    return () => { current = false; };
  });
</script>
<div class="qr-image">
{#if (routed ? generated : value || generated)}<img class="account-qr" src={routed ? generated : value || generated} alt={routed ? $i18n.text("QR контакта с адресом сети") : label} width="192" height="192" />
{:else if !error}<span role="status">{$i18n.text("Готовим QR…")}</span>{/if}
</div>
{#if contactUrl}
  <label class="route-toggle"><input type="checkbox" bind:checked={withRoute} />{$i18n.text("С адресом сети")}</label>
  <p class="qr-hint">{routed?$i18n.text("QR содержит Mesh ID и адрес сети для связи."):$i18n.text("Только Mesh ID. Сеть для связи потребуется выбрать отдельно.")}</p>
{/if}
{#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
<style>
 .qr-image{min-height:208px;display:grid;place-items:center;margin:12px 0;background:var(--surface-alt);border:1px solid var(--line);border-radius:12px;padding:8px;box-sizing:border-box}
 .account-qr{display:block;max-width:100%;height:auto;object-fit:contain;background:white;border-radius:8px}
 .route-toggle{display:flex;align-items:center;gap:8px;min-height:36px;font-size:13px;cursor:pointer}.route-toggle input{width:16px;height:16px;margin:0;flex:0 0 16px}
 .qr-hint{color:var(--muted);font-size:12px;line-height:1.5;margin:4px 0 12px}
</style>
