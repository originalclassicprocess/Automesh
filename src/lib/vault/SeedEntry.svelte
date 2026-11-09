<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount, tick } from 'svelte';
  import { normalizeSeedWord, seedWordIsValid, SEED_WORD_COUNTS } from './seed-words';
  let { onComplete, disabled = false }: { onComplete: (phrase: string) => void; disabled?: boolean } = $props();
  let count = $state(12);
  let words = $state<string[]>(Array(12).fill(''));
  let active = $state(0);
  let reveal = $state(true);
  let input = $state<HTMLInputElement>();
  let complete = $derived(words.every((word) => seedWordIsValid(word)));

  function focusWord(index: number): void {
    active = index; reveal = true;
    void tick().then(() => { input?.focus(); input?.select(); });
  }
  function next(): void {
    if (!words[active].trim()) return;
    words[active] = normalizeSeedWord(words[active]);
    focusWord(Math.min(active + 1, count - 1));
  }
  function paste(event: ClipboardEvent): void {
    const parts = event.clipboardData?.getData('text').trim().toLowerCase().split(/\s+/) ?? [];
    if (parts.length < 2) return;
    event.preventDefault();
    if (active === 0 && SEED_WORD_COUNTS.includes(parts.length)) { count = parts.length; words = Array(count).fill(''); }
    for (let index = 0; index < parts.length && active + index < count; index++) words[active + index] = parts[index];
    focusWord(Math.min(active + parts.length, count - 1));
  }
  onMount(() => {
    const hide = () => { if (document.hidden) { reveal = false; input?.blur(); } };
    document.addEventListener('visibilitychange', hide);
    return () => { words = words.map(() => ''); document.removeEventListener('visibilitychange', hide); };
  });
</script>

<form autocomplete="off" onsubmit={(event) => { event.preventDefault(); if (complete && !disabled) onComplete(words.map(normalizeSeedWord).join(' ')); }}>
  <label>{$i18n.text("Слов в вашей резервной seed-фразе")} <select value={count} disabled={disabled} onchange={(event) => {
    count = Number(event.currentTarget.value); words = Array(count).fill(''); active = 0; reveal = true;
  }}>
    {#each SEED_WORD_COUNTS as length}<option value={length}>{length}</option>{/each}
  </select></label>
  <p><small>{$i18n.text("Введите слово и нажмите пробел. Уже введённые слова скрываются; нажмите номер, чтобы исправить.")}</small></p>
  <div class="word-list" aria-label={$i18n.text("Введённые слова seed-фразы")}>
    {#each words as word, index}
      <button type="button" aria-pressed={active === index} class:invalid={!!word && !seedWordIsValid(word)} disabled={disabled}
        aria-label={$i18n("m_a9ab30aba714", {v0: (index + 1), v1: (word ? seedWordIsValid(word) ? $i18n.text(": введено") : $i18n.text(": опечатка") : $i18n.text(": пусто"))})} onclick={() => focusWord(index)}>
        {index + 1}. {word ? '••••••' : '—'}{#if word && !seedWordIsValid(word)} !{/if}
      </button>
    {/each}
  </div>
  <label for="recovery-word">{$i18n("m_6e92360582ac", {v0: (active + 1)})}</label>
  <div class="entry">
    <span class="masked-wrap"><input id="recovery-word" bind:this={input} type="text" value={words[active]} autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
      data-lpignore="true" data-1p-ignore data-bwignore disabled={disabled} class:masked={!reveal} class:invalid={!!words[active] && !seedWordIsValid(words[active])}
      aria-invalid={!!words[active] && !seedWordIsValid(words[active])}
      oninput={(event) => {
        const value = event.currentTarget.value.toLowerCase();
        words[active] = value;
        // Mobile keyboards do not always produce a keydown for the space key.
        if (/\s$/.test(value) && value.trim()) next();
      }} onpaste={paste}
      onkeydown={(event) => { if (event.key === ' ') { event.preventDefault(); next(); } }} />
      {#if !reveal}<span class="mask" aria-hidden="true">{'•'.repeat(Math.min(words[active].length, 32))}</span>{/if}
    </span>
    <button type="button" aria-label={reveal ? $i18n.text("Скрыть введённое слово") : $i18n.text("Показать введённое слово")} aria-pressed={reveal} onclick={() => reveal = !reveal}>👁</button>
    <button type="button" onclick={next} disabled={disabled || !words[active].trim() || active === count - 1}>{$i18n.text("Следующее слово")}</button>
  </div>
  {#if words[active] && !seedWordIsValid(words[active])}<p class="error">{$i18n.text("Такого слова нет в английском словаре seed. Проверьте написание.")}</p>{/if}
  <button type="submit" disabled={disabled || !complete}>{disabled ? $i18n.text("Проверяем…") : $i18n.text("Восстановить аккаунт")}</button>
</form>

<style>
  .word-list { display:grid; grid-template-columns:repeat(3, minmax(0, 1fr)); gap:6px; max-width:520px; margin-bottom:14px; }
  .word-list button[aria-pressed="true"] { outline:2px solid var(--focus); }
  .entry { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:6px 0 12px; }
  .masked-wrap { display:inline-block; position:relative; }
  .masked { color:transparent; caret-color:var(--text); }
  .mask { position:absolute; left:3px; top:2px; pointer-events:none; color:var(--text); max-width:95%; overflow:hidden; }
  .invalid { border:2px solid var(--danger); }
  .error { color:var(--danger); }
</style>
