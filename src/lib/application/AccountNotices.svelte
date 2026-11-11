<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  let { backup, devices, openBackup, openDevices, dismiss }: {
    backup: boolean; devices: boolean; openBackup: () => void; openDevices: () => void;
    dismiss: (kind: 'backup' | 'devices') => void;
  } = $props();
</script>
{#if backup || devices}
<aside aria-label={$i18n.text('Подсказки аккаунта')}>
  {#if backup}<div class="notice"><span class="important" aria-label={$i18n.text('Важно')}>!</span><span>{$i18n.text('Сохраните доступ к аккаунту')}</span><button class="action" onclick={openBackup}>{$i18n.text('Резервная копия')}</button><button class="close" onclick={() => dismiss('backup')} aria-label={$i18n.text('Скрыть напоминание о резервной копии')}>×</button></div>{/if}
  {#if devices}<div class="notice"><span class="important" aria-hidden="true">!</span><span>{$i18n.text('Ваш аккаунт на других устройствах')}</span><button class="action" onclick={openDevices}>{$i18n.text('Подключить')}</button><button class="close" onclick={() => dismiss('devices')} aria-label={$i18n.text('Скрыть предложение подключить устройство')}>×</button></div>{/if}
</aside>
{/if}
<style>
  aside{flex-shrink:0;display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.notice{display:flex;align-items:center;gap:8px;flex:1 1 330px;min-width:0;padding:5px 8px;border:1px solid var(--line);border-radius:9px;font-size:12px;background:var(--surface-alt)}
  .important{display:grid;place-items:center;flex-shrink:0;width:18px;height:18px;border-radius:50%;color:var(--warning,#d69e2e);border:1px solid currentColor;font-weight:800}.action{margin-left:auto;white-space:nowrap}.close{flex-shrink:0;font-size:20px;width:28px;padding:0}.notice button{min-height:28px;font-size:12px}.notice .close{font-size:20px;border:0;background:transparent;color:var(--muted)}
  @media(max-width:420px){.notice{gap:6px;flex-wrap:wrap}.notice>span:nth-child(2){flex:1}.action{margin-left:26px;order:2}.close{margin-left:auto}}
</style>
