<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { radioRecentlyHeard } from './reception';
  let { heard,now,connected }: {heard?:number;now:number;connected:boolean}=$props();
  const recent=$derived(connected&&radioRecentlyHeard(heard,now));
</script>
<small class="radio-presence" class:recent title={$i18n.text('Без опроса эфира: недавно получен пакет от этой платы. Это не подтверждает, что приложение собеседника открыто.')}>
  <span aria-hidden="true">◉</span> {$i18n.text(!connected?'LoRa отключена':recent?'Недавно по LoRa':heard?'LoRa: давно не слышали':'LoRa: пока не слышали')}
</small>
<style>.radio-presence{display:block!important;color:var(--muted);font-size:10px;line-height:1.4;font-weight:normal}.recent{color:var(--success)}</style>
