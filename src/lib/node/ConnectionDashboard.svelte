<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type { ConnectionOverview } from './connection-overview';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  let { state, onOpen }: { state: ConnectionOverview; onOpen(section: string): void } = $props();
</script>
<section class="dashboard" aria-label={$i18n.text("Обзор подключений")}>
  <h4>{$i18n.text("Состояние связи")} <HelpInfo label={$i18n.text("Справка: обзор подключений")} text={$i18n.text("Подключение не подтверждает доставку — смотрите статус сообщения. Домашние и серверные ноды работают с очередью одинаково. Можно использовать несколько каналов связи; очередь новых отправок одна и не копируется на резервную ноду. Получение с нод собеседников показано в диагностике.")} /></h4>
  <div class="grid">
    <button onclick={() => onOpen('servers')}><strong>{$i18n.text("Сигналинг")}</strong><span>{state.signaling === 'connected' ? $i18n.text("Доступен") : state.signaling === 'disabled' ? $i18n.text("Отключён в настройках") : $i18n.text("Соединение не подтверждено")}</span></button>
    <button onclick={() => onOpen('direct')}><strong>{$i18n.text("Прямые соединения")}</strong><span>{state.direct ? $i18n("m_d465f5830f81", {v0: (state.direct)}) : $i18n.text("Сейчас нет активных каналов")}</span></button>
    <button onclick={() => onOpen('nodes')}><strong>{$i18n.text("Очередь отправки")}</strong><span>{state.queue === 'connected' ? $i18n.text("Нода доступна") : state.queue === 'unselected' ? $i18n.text("Нода доставки не выбрана") : state.queue === 'disabled' ? $i18n.text("Новые отправки через ноду выключены") : $i18n.text("Связь с очередью проверяется")}</span></button>
    <button onclick={() => onOpen('diagnostics')}><strong>{$i18n.text("Получение")}</strong><span>{state.receiver === 'connected' ? $i18n.text("Основной канал подключён") : state.receiver === 'unselected' ? $i18n.text("Своя очередь не настроена") : $i18n.text("Основной канал проверяется")}</span></button>
  </div>
  <p>{$i18n("m_67c32701d6df", {v0: (state.pending)})}</p>
  {#if state.rights !== 'primary'}<p>{$i18n("m_6ebca3c04f9a", {v0: (state.rights === 'node' ? $i18n.text("через ноду") : state.rights === 'direct' ? $i18n.text("через доступного владельца") : $i18n.text("не подготовлена"))})}</p>{/if}
  {#if state.queue === 'unselected'}<p>{$i18n.text("Для отложенной отправки выберите ноду в «Ноды доставки». Сигналинг и доступ к панели не подключают очередь.")}</p>{/if}
  {#if state.paused}<p role="status">{$i18n.text("Сигналинг выключен. Очередь и права устройств проверяются отдельно. Нужные подключения можно включить в «Параметры сети».")}</p>{/if}
</section>
<style>
  section{padding:16px;border:1px solid var(--line);border-radius:18px}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}button{text-align:left;padding:14px;min-height:88px;min-width:0}strong,span{display:block}span{font-size:13px;color:var(--muted);margin-top:7px}p{font-size:13px;line-height:1.5}@media(max-width:480px){.grid{grid-template-columns:1fr}}
</style>
