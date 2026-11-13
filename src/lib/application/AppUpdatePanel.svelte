<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
import type { AppUpdateState } from './app-update';
import HelpInfo from './HelpInfo.svelte';
let { state: update, version, discardTemporary = false, onCheck, onApply } = $props<{
  state: AppUpdateState; version: string; discardTemporary?: boolean;
  onCheck: () => void; onApply: () => void;
}>();
let confirmed = $state(false);
const busy = $derived(['checking', 'downloading', 'applying'].includes(update.phase));
$effect(() => { if (update.phase !== 'available' || !discardTemporary) confirmed = false; });
</script>

<section aria-label={$i18n.text("Обновление приложения")}>
  <h4>{$i18n.text("Версия и обновления")} <HelpInfo label={$i18n.text("Справка: обновления")} text={$i18n.text("Проверка сравнивает эту вкладку с опубликованной версией. Обновление заменяет код приложения, но не очищает доверенный аккаунт и историю. Другие вкладки обновляются отдельно; временный недоверенный сеанс может исчезнуть.")} /> {#if update.phase === 'available'}<span class="available">{$i18n.text("Есть обновление")}</span>{/if}</h4>
  <small>{$i18n.text("Версия этой вкладки:")} <code>{version}</code></small>
  <p role="status" aria-live="polite" class:waiting={busy} class:complete={update.phase==='current'||update.phase==='available'} class:failed={update.phase==='error'} class:neutral={update.phase==='idle'||update.phase==='unsupported'}>{$i18n.text(update.message)}</p>
  <button type="button" onclick={onCheck} disabled={busy}>{$i18n.text("Проверить обновления")}</button>
  {#if update.phase === 'available'}
    {#if discardTemporary}
      <p class="warning">{$i18n.text("Недоверенная сессия хранится в памяти. Обновление закроет её и удалит временную историю. Чтобы сохранить её, сначала включите доверенный режим.")}</p>
      <label><input type="checkbox" bind:checked={confirmed} /> {$i18n.text("Обновить без сохранения временной сессии")}</label><br />
    {/if}
    <button type="button" onclick={onApply} disabled={discardTemporary && !confirmed}>{$i18n.text("Обновить приложение")}</button>
    <small>{$i18n.text("Обновится только эта вкладка. Доверенный вход и сохранённая история останутся; аккаунт заблокируется.")}</small>
  {/if}
</section>

<style>
  .waiting{color:var(--warning)}.complete{color:var(--success)}.failed{color:var(--danger)}.neutral{color:var(--muted)}
  section { margin-top: 1.2rem; }
  small { display: block; overflow-wrap: anywhere; margin: .5rem 0; }
  button { margin: 0 .5rem .5rem 0; }
  .warning { color: var(--danger); }
  .available { display:inline-block; padding:3px 7px; border-radius:10px; background:var(--success-soft); color:var(--success); font-size:12px; }
</style>
