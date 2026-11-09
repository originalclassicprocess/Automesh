<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  let { busy, onSetup }: { busy: boolean; onSetup(): void } = $props();
</script>
<section class="node-start" aria-label={$i18n.text("Своя нода дома")}>
  <h4>{$i18n.text("Своя нода дома")} <HelpInfo label={$i18n.text("Справка: доступность домашней ноды")} text={$i18n.text("Для доставки вне дома нужен доступный интернет-маршрут; он может использовать реле. Включённый ПК не гарантирует связь из любой сети. Телефон пока не поддерживается как постоянно работающая нода.")} /></h4>
  <p>{$i18n.text("Отдельный сервер арендовать не обязательно. Домашний компьютер может хранить зашифрованную очередь, пока приложение отправителя закрыто.")}</p>
  <ol><li>{$i18n.text("Установите ноду Windows на свой компьютер.")}</li><li>{$i18n.text("Запустите её и подключите профиль по QR или коду привязки.")}</li><li>{$i18n.text("Оставьте компьютер включённым, без сна, с рабочим маршрутом связи.")}</li></ol>
  <button disabled={busy} onclick={onSetup}>{$i18n.text("Установка и настройка домашней ноды")}</button>
  <details><summary>{$i18n.text("Использовать чужую ноду")}</summary><p>{$i18n.text("Попросите приглашение у владельца ноды. Сообщения хранятся зашифрованно; доступность и квоты зависят от этой ноды. Магазина размещения пока нет.")}</p></details>
</section>
<style>
  .node-start { padding:14px; border:1px solid var(--line); border-radius:16px; background:var(--accent-soft); margin:12px 0; }
  h4 { margin:0; } p, li { font-size:14px; line-height:1.55; } ol { padding-left:22px; } li { margin:6px 0; }
  button { min-height:44px; border-radius:12px; width:100%; }
  details { margin-top:12px; } summary { cursor:pointer; font-size:13px; }
</style>
