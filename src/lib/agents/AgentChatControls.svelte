<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  let { working, disabled, canDraft, automatic, remaining, notice, draft, stop, toggleAuto }:
    { working: boolean; disabled: boolean; canDraft: boolean; automatic: boolean; remaining: number; notice: string;
      draft: () => void; stop: () => void; toggleAuto: () => void } = $props();
  let open = $state(false);
</script>

<div class="agent-tools">
  <div class="agent-bar">
    <button type="button" class="agent-toggle" aria-expanded={open} onclick={() => open = !open}><span class="mark" aria-hidden="true">AI</span> {$i18n.text('Помощник ИИ')} <span aria-hidden="true">{open ? '−' : '+'}</span></button>
    {#if working}<span class="indicator" role="status">{$i18n.text('Модель выполняет запрос…')}</span><button type="button" onclick={stop}>{$i18n.text('Отменить запрос ИИ')}</button>
    {:else if automatic}<span class="indicator active">/ai · {remaining}</span>{/if}
  </div>
  {#if open}
    <div class="agent-expanded">
      <button type="button" disabled={working || disabled || !canDraft} onclick={draft}>{$i18n.text('ИИ: черновик ответа')}</button>
      <button type="button" class:active={automatic} aria-pressed={automatic} disabled={disabled || (!automatic && remaining <= 0)} onclick={toggleAuto}>{automatic ? $i18n.text('Отключить ответы на /ai') : $i18n.text('Разрешить ответы на /ai')}</button>
      <p>{$i18n.text('Черновик можно проверить и изменить перед отправкой.')}</p>
      <p>{$i18n.text('Ответы на /ai отправляются автоматически только этому контакту. Разрешение действует до смены или блокировки аккаунта.')}</p>
      <p>{$i18n.text('Осталось автоматических запросов:')} {remaining}</p>
    </div>
  {/if}
  {#if notice && !working}<p class="notice" role="status">{$i18n.text(notice)}</p>{/if}
</div>

<style>
  .agent-tools { border:1px solid var(--line); border-radius:11px; margin:4px 0; padding:5px 8px; }
  .agent-bar { display:flex; align-items:center; gap:7px; flex-wrap:wrap; }
  button { font-size:12px; min-height:34px; padding:6px 9px; }
  .agent-toggle { display:flex; align-items:center; gap:6px; border:0; background:transparent; padding-left:2px; }
  .mark { border:1px solid var(--line); border-radius:5px; font-size:10px; padding:3px; }
  .indicator { color:var(--muted); font-size:11px; flex:1; }
  .active { color:var(--accent); }
  .agent-expanded { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,155px),1fr)); gap:6px; margin-top:5px; padding-top:7px; border-top:1px solid var(--line); }
  .agent-expanded p { grid-column:1/-1; }
  p { margin:2px 0; font-size:12px; color:var(--muted); line-height:1.4; }
  .notice { padding-top:4px; }
</style>
