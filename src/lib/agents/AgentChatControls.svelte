<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import { MAX_AGENT_MINUTES, MAX_AGENT_REQUESTS, radioAgentSender, senderAgentLimit, type AgentChatPolicy } from './limits';

  let { working, disabled, automatic, notice, toggleAuto, policy, save, ownBoard, knownBoards = [] }:
    { working: boolean; disabled: boolean; automatic: boolean; notice: string; toggleAuto: () => void;
      policy?: AgentChatPolicy; save?: (value: AgentChatPolicy) => Promise<boolean>; ownBoard?: number; knownBoards?: number[] } = $props();
  let open = $state(false);
  let saving = $state(false), error = $state(''), boardInput = $state('');
  let unlimited = $state(true), count = $state<number | undefined>(1), minutes = $state<number | undefined>(60);
  const boardListId = $props.id();
  const native = $derived(ownBoard !== undefined);
  const sender = $derived(radioAgentSender(boardInput));
  const hasOverride = $derived(!!sender && Object.hasOwn(policy?.senders ?? {}, sender));
  const boardIds = $derived([...new Set([...(ownBoard !== undefined ? [ownBoard] : []), ...knownBoards, ...Object.keys(policy?.senders ?? {}).map(Number)])]);

  function loadLimit() {
    const selected = radioAgentSender(boardInput);
    const value = selected && policy ? senderAgentLimit(policy, selected, Number(selected) === ownBoard) : policy?.limit;
    unlimited = !value;
    count = value?.count ?? 1;
    minutes = value?.minutes ?? 60;
    error = '';
  }

  async function saveLimit(remove = false) {
    if (!policy || !save || saving || disabled) return;
    const selected = radioAgentSender(boardInput);
    if (boardInput.trim() && !selected) { error = 'Укажите номер платы или ID вида !a1b2c3d4.'; return; }
    if (!remove && !unlimited && (!count || !minutes || !Number.isInteger(count) || !Number.isInteger(minutes) ||
      count < 1 || minutes < 1 || count > MAX_AGENT_REQUESTS || minutes > MAX_AGENT_MINUTES)) {
      error = 'Укажите допустимое количество запросов и период.'; return;
    }
    const value = unlimited ? null : { count: count!, minutes: minutes! };
    const senders = { ...policy.senders };
    if (selected) {
      if (remove) delete senders[selected];
      else senders[selected] = value;
    }
    saving = true;
    error = '';
    try {
      if (await save({ limit: selected ? policy.limit : value, senders })) {
        if (remove) { boardInput = ''; loadLimit(); }
        error = 'Лимит сохранён.';
      } else error = 'Не удалось сохранить лимит.';
    } finally { saving = false; }
  }
</script>

<button type="button" class="icon-button ai-button" class:automatic aria-label={$i18n.text('Автоответы ИИ')}
  title={$i18n.text(automatic ? 'Автоответы включены' : 'Автоответы ИИ')}
  aria-haspopup="dialog" aria-expanded={open} aria-busy={working} onclick={() => { boardInput = ''; loadLimit(); open = true; }}>AI</button>

{#if open}
  <CompactDialog title={$i18n.text('Автоответы ИИ')} literalTitle onClose={() => open = false}>
    <label>
      <input type="checkbox" checked={automatic} {disabled} onchange={toggleAuto} />
      <strong>{$i18n.text(native ? 'Отвечать на /ai в этом канале' : 'Отвечать этому контакту')}</strong>
    </label>
    {#if native}
      <p>{$i18n.text('Напишите /ai и запрос. Ответ увидят участники канала. Запрос передаётся выбранной модели. После блокировки ответы нужно включить снова.')}</p>
    {:else}
      <p>{$i18n.text('ИИ отвечает на новые текстовые сообщения в этом чате, пока аккаунт открыт. После блокировки разрешение нужно включить снова.')}</p>
    {/if}
    {#if policy && save}
      <fieldset disabled={disabled || saving}>
        <legend>{$i18n.text('Лимит запросов в чате')}</legend>
        {#if native}
          <label class="field">{$i18n.text('ID платы для исключения')}
            <input type="text" list={boardListId} value={boardInput} maxlength="12" placeholder={$i18n.text('Пусто для всех участников')} onchange={event => { boardInput = event.currentTarget.value; loadLimit(); }} />
          </label>
          <datalist id={boardListId}>
            {#each boardIds as node}<option value={'!' + node.toString(16)} label={node === ownBoard ? $i18n.text('Моя плата') : undefined}></option>{/each}
          </datalist>
          <p>{$i18n.text('Лимит считается для каждой платы отдельно. Для своей платы по умолчанию лимита нет. Номер платы не подтверждает личность.')}</p>
        {/if}
        <label><input type="checkbox" bind:checked={unlimited} />{$i18n.text('Без лимита')}</label>
        {#if !unlimited}
          <div class="limit-fields">
            <label class="field">{$i18n.text('Запросов')}<input type="number" min="1" max={MAX_AGENT_REQUESTS} step="1" bind:value={count} /></label>
            <label class="field">{$i18n.text('Период, мин')}<input type="number" min="1" max={MAX_AGENT_MINUTES} step="1" bind:value={minutes} /></label>
          </div>
        {/if}
        <div class="limit-actions">
          <button type="button" onclick={() => void saveLimit()}>{$i18n.text('Сохранить лимит')}</button>
          {#if hasOverride}<button type="button" onclick={() => void saveLimit(true)}>{$i18n.text('Сбросить исключение')}</button>{/if}
        </div>
        {#if error}<p role="status">{$i18n.text(error)}</p>{/if}
      </fieldset>
    {/if}
    {#if working || notice}<p role="status">{working ? $i18n.text('Модель выполняет запрос…') : $i18n.text(notice)}</p>{/if}
  </CompactDialog>
{/if}

<style>
  .ai-button { font-size:13px; font-weight:700; }
  .ai-button.automatic { border-color:var(--accent); color:var(--accent); }
  label { display:flex; align-items:center; gap:10px; min-height:44px; cursor:pointer; }
  input[type=checkbox] { margin:0; width:18px; height:18px; flex:none; }
  p { margin:6px 0 0; font-size:13px; color:var(--muted); line-height:1.4; }
  fieldset { border:1px solid var(--line); border-radius:9px; margin:12px 0 0; min-width:0; padding:10px; }
  .field { display:grid; gap:5px; min-width:0; font-size:13px; }
  .field input { min-width:0; width:100%; box-sizing:border-box; }
  .limit-fields { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .limit-actions { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
</style>
