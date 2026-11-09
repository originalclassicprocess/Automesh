<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { untrack } from 'svelte';
  import type { MessageDetails } from './message-details';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  let { value, onSave, onClose }: { value?: MessageDetails['ephemeral']; onSave(value: MessageDetails['ephemeral']): void; onClose(): void } = $props();
  let seconds = $state(untrack(() => value?.seconds ?? 0)), views = $state(untrack(() => value?.views ?? 0)), allowDownload = $state(untrack(() => value?.allowDownload ?? false));
  function dialog(node: HTMLDialogElement) { node.showModal(); return { destroy() { node.close(); } }; }
</script>
<dialog use:dialog oncancel={event => { event.preventDefault(); onClose(); }} aria-labelledby="send-options-title">
  <header><h3 id="send-options-title">{$i18n.text("Настройки следующей отправки")}</h3><button onclick={onClose} aria-label={$i18n.text("Закрыть настройки отправки")}>✕</button></header>
  <label>{$i18n.text("Таймер после первого открытия")}
    <select bind:value={seconds}><option value={0}>{$i18n.text("Без таймера")}</option><option value={10}>{$i18n.text("10 секунд")}</option><option value={60}>{$i18n.text("1 минута")}</option><option value={3600}>{$i18n.text("1 час")}</option><option value={86400}>{$i18n.text("1 день")}</option><option value={604800}>{$i18n.text("7 дней")}</option></select>
  </label>
  <label>{$i18n.text("Количество открытий")}
    <select bind:value={views}><option value={0}>{$i18n.text("Без ограничения")}</option><option value={1}>{$i18n.text("1 просмотр")}</option><option value={3}>{$i18n.text("3 просмотра")}</option><option value={5}>{$i18n.text("5 просмотров")}</option><option value={10}>{$i18n.text("10 просмотров")}</option></select>
  </label>
  {#if seconds || views}
    <label class="check"><input type="checkbox" bind:checked={allowDownload} /> {$i18n.text("Разрешить скачивание")}</label>
    <HelpInfo label={$i18n.text("Справка: таймер и просмотры")} text={$i18n.text("Просмотр засчитывается по нажатию «Открыть». Если заданы таймер и число просмотров, сработает первое ограничение. Таймер идёт и при закрытом приложении; последний просмотр доступен до его закрытия или окончания таймера. Подтверждение открытия отправляется независимо от отметок о прочтении. Материалы исключаются из резервных копий и пересылки. Нужны совместимые клиенты с обеих сторон; синхронизация дополнительных устройств не поддерживается.")} />
    <p>{$i18n.text("Ограничения действуют на этом устройстве получателя и не защищают от скриншотов, записи экрана или изменённого клиента. Скачанная копия остаётся у получателя.")}</p>
  {:else}<p>{$i18n.text("Обычная отправка: сообщения и файлы сохраняются как всегда.")}</p>{/if}
  <footer><button onclick={() => onSave(undefined)}>{$i18n.text("Обычная отправка")}</button><button class="primary" onclick={() => onSave(seconds || views ? { ...(seconds ? { seconds } : {}), ...(views ? { views } : {}), allowDownload } : undefined)}>{$i18n.text("Применить")}</button></footer>
</dialog>
<style>
  dialog { width:min(460px,calc(100vw - 24px)); max-height:85dvh; overflow:auto; box-sizing:border-box; }
  header, footer { display:flex; align-items:center; justify-content:space-between; gap:8px; } h3 { margin:0; font-size:18px; }
  label { display:grid; gap:8px; margin:18px 0; font-size:14px; } select { width:100%; } .check { display:flex; align-items:center; }
  p { color:var(--muted); font-size:12px; line-height:1.5; } footer { flex-wrap:wrap; }
</style>
