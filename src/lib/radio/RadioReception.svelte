<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { radioQuality, type RadioReception } from './reception';
  let { reception }: { reception:RadioReception }=$props();
  const quality=$derived(radioQuality(reception));
</script>
<details class="radio-reception">
  <summary title={$i18n.text('Качество приёма LoRa')}>
    <span>LoRa</span>
    {#if quality}<span class="bars {quality.tone}" aria-label={$i18n.text(quality.label)}>{#each [1,2,3,4,5] as bar}<i class:filled={bar<=quality.level} style:height={`${4+bar*2}px`}></i>{/each}</span><span>{$i18n.text(quality.label)}</span>{/if}
    {#if reception.hops && reception.hops>0}<span aria-label={$i18n.text('Ретрансляции')}>🐇 {reception.hops}</span>{/if}
  </summary>
  <div class="values">
    {#if reception.rssi!==undefined}<span>RSSI: {reception.rssi} dBm</span>{/if}
    {#if reception.snr!==undefined}<span>SNR: {reception.snr.toFixed(1)} dB</span>{/if}
    <span>{$i18n.text('Ретрансляции')}: {reception.hops??$i18n.text('Неизвестно')}</span>
    <small>{$i18n.text('Оценка по принятому пакету. Через ретранслятор измеряется последний радиоучасток, а не весь путь до собеседника. Для сообщения из нескольких частей показан худший приём.')}</small>
  </div>
</details>
<style>
 .radio-reception{margin-top:5px;font-size:10px;color:var(--muted)}summary{display:flex;align-items:center;gap:6px;cursor:pointer;list-style:none;width:fit-content;padding:3px 5px;border-radius:6px;min-height:24px}summary::-webkit-details-marker{display:none}summary::after{display:none!important}summary:hover{background:var(--surface-alt)}.bars{display:flex;align-items:flex-end;gap:2px;height:16px}.bars i{display:block;width:3px;border-radius:1px;background:var(--line)}.bars i.filled{background:currentColor}.success{color:var(--success)}.warning{color:var(--warning)}.danger{color:var(--danger)}.values{display:flex;flex-wrap:wrap;gap:4px 12px;padding:6px;background:var(--surface-alt);border-radius:6px;max-width:330px}.values small{flex-basis:100%;line-height:1.5}
</style>
