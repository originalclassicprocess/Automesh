<script lang="ts">
  import {tr as i18n} from '$lib/i18n/language';
  import type {ChannelEncryption} from './native-channels';
  let {value='unknown',compact=false}:{value?:ChannelEncryption;compact?:boolean}=$props();
  const label=$derived(value==='custom'?'Собственный ключ канала':value==='default'?'Общеизвестный ключ канала':value==='none'?'Без шифрования':'Тип ключа ещё не проверен');
  const detail=$derived(value==='custom'?'Сообщения доступны участникам с ключом. Замок не подтверждает личность отправителя.':value==='default'?'Ключ известен публично. Шифрование не обеспечивает приватность канала.':value==='none'?'Сообщения передаются без шифрования канала.':'Подключите эту плату, чтобы проверить тип ключа.');
</script>
<span class="security" class:custom={value==='custom'} class:public-key={value==='default'} class:unencrypted={value==='none'} title={$i18n.text(detail)} aria-label={$i18n.text(label)}>
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"/>{#if value==='none'}<path d="M9 10V6a4 4 0 0 1 8 0"/>{:else}<path d="M8 10V6a4 4 0 0 1 8 0v4"/>{/if}<path d="M12 14v3"/></svg>
  {#if !compact}<span>{$i18n.text(label)}</span>{/if}
</span>
<style>
 .security{display:inline-flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);min-width:0}.custom{color:var(--success)}.public-key{color:var(--warning)}.unencrypted{color:var(--danger)}svg{flex-shrink:0}
</style>
