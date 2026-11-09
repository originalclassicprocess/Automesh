<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import {onMount} from 'svelte';
  import {freshQueueSnapshot,readMessageQuota,type QueueSnapshot} from './queue-quota';
  let {snapshot,connected=true,kind='files'}:{snapshot?:QueueSnapshot;connected?:boolean;kind?:'files'|'messages'}=$props();
  let now=$state(Date.now());
  const fresh=$derived(connected&&freshQueueSnapshot(snapshot,now));
  const quota=$derived(snapshot?.quota);
  const messages=$derived(readMessageQuota(quota));
  onMount(()=>{const t=setInterval(()=>now=Date.now(),5000);return()=>clearInterval(t);});
</script>
{#if quota}
  <p class="heading">{kind==='messages'?$i18n.text("Квота сообщений"):$i18n.text("Квота файлов")}{!fresh?$i18n.text("· данные устарели"):''}</p>
  {#if kind==='messages'&&messages}
  <dl>
    <div><dt>{$i18n.text("Конверты профиля")}</dt><dd>{messages.profileMessages} / {messages.profileMessageLimit}</dd></div>
  </dl><p class="note">{$i18n.text("Учтены ваши сообщения и описания файлов, ожидающие получения.")}</p>
  {:else if kind==='messages'}<p class="note">{$i18n.text("Нода не сообщила лимит сообщений. Неизвестная квота не считается свободной.")}</p>
  {:else}<dl>
    <div><dt>{$i18n.text("Файлы профиля")}</dt><dd>{quota.profileFiles} / {quota.profileFileLimit}</dd></div>
  </dl>
  <p class="note">{$i18n.text("Учтены ваши сохранённые файлы и незавершённые загрузки.")}</p>{/if}
{:else}<p class="note">{$i18n.text("Квота не получена. Проверьте связь с нодой; она должна поддерживать передачу сведений о квотах.")}</p>{/if}
{#if snapshot}<small>{$i18n("m_9fa2d4473d85", {v0: (new Date(snapshot.checkedAt).toLocaleTimeString($uiLocale)), v1: (fresh?'':$i18n.text("Текущая доступность квоты не подтверждена."))})}</small>{/if}
<style>
  .heading{font-size:13px;font-weight:600;margin:12px 0 8px}dl{font-size:13px;margin:0}dl div{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}dt{color:var(--muted)}dd{margin:0;font-variant-numeric:tabular-nums}.note,small{font-size:12px;color:var(--muted);line-height:1.5}.note{margin:10px 0}small{display:block}
</style>
