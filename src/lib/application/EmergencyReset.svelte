<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  let { busy, error, close, reset }: { busy: boolean; error: string; close: () => void; reset: () => void } = $props();
  let stage = $state(1);
  function mount(node: HTMLDialogElement) {
    const previous = document.activeElement as HTMLElement | null;
    node.showModal();
    return { destroy() { node.close(); previous?.focus(); } };
  }
</script>
<dialog use:mount oncancel={event => { event.preventDefault(); if (!busy) close(); }} aria-labelledby="erase-title">
  <h3 id="erase-title">{$i18n.text("🔥 Экстренное стирание")}</h3>
  {#if stage === 1}
    <p>{$i18n.text("Выйти и удалить данные")} <strong>{$i18n.text("всех аккаунтов Automesh")}</strong> {$i18n.text("на этом адресе сайта в этом профиле браузера?")}</p>
    <p>{$i18n.text("Сейф с seed, переписка, контакты, вложения и офлайн-кэш будут удалены. Другие открытые вкладки новой версии завершат сеансы.")}</p>
    <p><small>{$i18n.text("Другие устройства, адреса сайта, старые клиенты и скачанные файлы не затрагиваются. Браузер не гарантирует физическое уничтожение следов на диске.")}</small></p>
    <button onclick={() => stage = 2}>{$i18n.text("Продолжить")}</button>
  {:else}
    <p><strong>{$i18n.text("Последнее подтверждение. Удаление нельзя отменить.")}</strong></p>
    <p>{$i18n.text("Без seed или резервной копии вернуться в аккаунт не получится. Для загрузки приложения заново понадобится доступ к сайту.")}</p>
    <button onclick={reset} disabled={busy}>{busy ? $i18n.text("Стираем…") : $i18n.text("Да, выйти и стереть всё")}</button>
  {/if}
  <button onclick={close} disabled={busy}>{$i18n.text("Отмена")}</button>
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
</dialog>
<style>dialog { max-width:480px; padding:20px; border-radius:10px; } dialog::backdrop { background:var(--overlay); } button { margin:4px; } small { line-height:1.4; }</style>
