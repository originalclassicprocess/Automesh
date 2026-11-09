<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { chooseTheme,isThemeMode,themeMode } from './theme';
  let warning=$state(false);
</script>
<div class="theme-selector">
  <label>{$i18n.text("Цветовая тема")}
    <select value={$themeMode} onchange={event=>{const value=event.currentTarget.value;if(isThemeMode(value))warning=!chooseTheme(value);}}>
      <option value="system">{$i18n.text("Как в системе")}</option><option value="light">{$i18n.text("Светлая")}</option><option value="dark">{$i18n.text("Тёмная")}</option>
    </select>
  </label>
  <p class="help-text">{$i18n.text("Применяется ко всему приложению, включая новые разделы. «Как в системе» автоматически следует теме устройства.")}</p>
  {#if warning}<p role="status">{$i18n.text("Тема применена, но браузер не разрешил сохранить выбор для следующего запуска.")}</p>{/if}
</div>
<style>label{display:flex;align-items:center;gap:12px;flex-wrap:wrap}select{min-width:0;flex:1}p{color:var(--muted);font-size:13px}</style>
