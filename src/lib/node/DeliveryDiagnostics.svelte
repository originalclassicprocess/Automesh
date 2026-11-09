<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import type { DeliveryDiagnostics } from './delivery-diagnostics';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  let { channel, queueReachable, keys, diagnostics, channelFailure = '', busy = false, expanded = false, onRetry }: {
    channel: string; queueReachable: boolean; keys: number; diagnostics: DeliveryDiagnostics; channelFailure?:string; busy?: boolean; expanded?:boolean; onRetry(): void;
  } = $props();
  const time = (value:number) => value ? new Date(value).toLocaleTimeString($uiLocale) : 'В этом сеансе ещё не было';
</script>
<details class="delivery-diagnostics" open={expanded}>
  <summary>{$i18n.text("Проверки получения")}</summary>
  <dl>
    <dt>{$i18n.text("Доступ к очереди моей ноды")}</dt><dd>{queueReachable ? $i18n.text("Есть") : $i18n.text("Не подтверждён")}</dd>
    <dt>{$i18n.text("Основной канал получения")}</dt><dd>{$i18n.system(channel)}</dd>
    <dt>{$i18n.text("Получение со своей ноды по HTTPS")}</dt><dd>{diagnostics.inboxSupported === true ? (diagnostics.inboxFailure ? $i18n.text("Повторяем подключение") : diagnostics.inboxAt ? $i18n.text("Подключено") : $i18n.text("Проверяем")) : diagnostics.inboxSupported === false ? $i18n.text("Не поддерживается этой нодой") : $i18n.text("Ещё не проверено")}</dd>
    <dt>{$i18n.text("Последняя проверка входящей очереди")}</dt><dd>{$i18n.text(time(diagnostics.inboxAt ?? 0))}</dd>
    <dt>{$i18n.text("Получение с нод собеседников")}</dt><dd>{diagnostics.remoteInboxSources ? $i18n("m_b859207ba3f3", {v0: (diagnostics.remoteInboxSources), v1: (diagnostics.remoteInboxFailure ? $i18n.text("повторяем подключение") : diagnostics.remoteInboxAt ? 'HTTPS' : $i18n.text("проверяем"))}) : $i18n.text("Нет полученных разрешений")}</dd>
    {#if diagnostics.remoteInboxSources}<dt>{$i18n.text("Последняя проверка ноды собеседника")}</dt><dd>{$i18n.text(time(diagnostics.remoteInboxAt ?? 0))}</dd>{/if}
    <dt>{$i18n.text("Действующие ключи получения")}</dt><dd>{keys}</dd>
    <dt>{$i18n.text("Последний проверенный конверт")}</dt><dd>{$i18n.text(time(diagnostics.envelopeAt))}</dd>
    <dt>{$i18n.text("Последнее сохранение в приложении")}</dt><dd>{$i18n.text(time(diagnostics.savedAt))}</dd>
    <dt>{$i18n.text("Последнее подтверждение получения")}</dt><dd>{$i18n.text(time(diagnostics.receiptAt))}</dd>
  </dl>
  {#if channelFailure}<p role="status">{$i18n.text(channelFailure)}</p>{/if}
  {#if diagnostics.failure}<p role="status">{$i18n.system(diagnostics.failure)}</p>{/if}
  {#if diagnostics.inboxFailure}<p role="status">{$i18n.system(diagnostics.inboxFailure)}</p>{/if}
  {#if diagnostics.remoteInboxFailure}<p role="status">{$i18n.system(diagnostics.remoteInboxFailure)}</p>{/if}
  <button type="button" disabled={busy} onclick={onRetry}>{$i18n.text("Восстановить подключение")}</button>
  <HelpInfo label={$i18n.text("Справка: диагностика получения")} text={$i18n.text("Здесь только состояние проверок, без текста сообщений и секретов. HTTPS-получение не зависит от сигналинга. Для ноды собеседника нужны заранее выданные ключи и подписанное разрешение; своя нода не обязательна. «Ещё не проверено» не означает ошибку или устаревшую ноду. Отправка подтверждения не гарантирует, что нода уже обработала его.")} />
</details>
<style>
  details{border:1px solid var(--line);border-radius:12px;padding:12px;margin:12px 0;font-size:13px}summary{cursor:pointer}dl{display:grid;grid-template-columns:1fr 1fr;gap:8px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}p{color:var(--danger)}@media(max-width:420px){dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:6px}}
</style>
