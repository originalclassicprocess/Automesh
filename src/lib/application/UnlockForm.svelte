<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  let { password = $bindable(''), busy = false, editableWhileBusy = false, onUnlock, onInput = () => {}, onKeydown = () => {} }: {
    password: string; busy?: boolean; editableWhileBusy?: boolean; onUnlock(): void; onInput?: () => void; onKeydown?: (event: KeyboardEvent) => void;
  } = $props();
</script>
<form onsubmit={event => { event.preventDefault(); onUnlock(); }}>
  <h3>{$i18n.text("Вход 🔐")}</h3>
  <input type="password" name="password" autocomplete="current-password" bind:value={password} placeholder={$i18n.text("Пароль")} aria-label={$i18n.text("Пароль")}
    onkeydown={onKeydown} oninput={onInput} disabled={busy && !editableWhileBusy} />
  <button type="submit" disabled={busy}>{busy ? $i18n.text("Проверяем…") : $i18n.text("Войти")}</button>
</form>
<style>
  form{width:100%}input{display:block;width:100%;margin:6px 0 14px}button{display:block;width:100%;min-height:44px;margin:10px 0}
</style>
