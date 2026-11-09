<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import { loadVault } from './vault';
  import { backupWordPositions, verifyBackupWords } from './seed-backup';
  import { seedWordIsValid } from './seed-words';
  import SeedWords from './SeedWords.svelte';
  import EncryptedBackup from './EncryptedBackup.svelte';
  import type { ProfileRegistry } from '$lib/core/profiles';

  let { initialSeed = null, onSeedConsumed, onVerified, onSkip, accountId = '', nickname = '', readProfiles }: {
    initialSeed?: Uint8Array | null;
    onSeedConsumed: () => void;
    onVerified: () => Promise<boolean>;
    onSkip: () => void;
    accountId?: string;
    nickname?: string;
    readProfiles?: (seed: Uint8Array) => Promise<ProfileRegistry | undefined>;
  } = $props();
  let phase = $state<'prompt' | 'password' | 'words' | 'check' | 'success'>('prompt');
  let password = $state('');
  let shownWords = $state<string[]>([]);
  let positions = $state<number[]>([]);
  let answers = $state<string[]>([]);
  let visibleAnswers = $state<boolean[]>([]);
  let wrongAnswers = $state<boolean[]>([]);
  let method = $state<'paper' | 'file'>('paper');
  let error = $state('');
  let busy = $state(false);
  let secret: Uint8Array | null = null;
  let workToken = 0;

  function forgetSecret(): void {
    workToken++;
    secret?.fill(0);
    secret = null;
    password = '';
    shownWords = [];
    positions = [];
    answers = [];
    visibleAnswers = [];
    wrongAnswers = [];
    busy = false;
    onSeedConsumed();
  }

  function displayWords(bytes: Uint8Array): void {
    secret?.fill(0);
    secret = bytes;
    shownWords = new TextDecoder().decode(bytes).trim().split(/\s+/);
    password = '';
    error = '';
    phase = 'words';
  }

  function start(): void {
    error = '';
    if (initialSeed) {
      const bytes = initialSeed.slice();
      onSeedConsumed();
      displayWords(bytes);
    } else {
      phase = 'password';
    }
  }

  async function authenticate(): Promise<void> {
    if (busy) return;
    busy = true;
    error = '';
    const token = ++workToken;
    try {
      const vault = await loadVault(password);
      password = '';
      if (token !== workToken) { vault?.mnemonic.fill(0); return; }
      if (!vault) { error = 'Неверный пароль.'; return; }
      displayWords(vault.mnemonic);
    } catch {
      if (token === workToken) error = 'Не удалось открыть фразу. Попробуйте ещё раз.';
    } finally {
      if (token === workToken) { busy = false; password = ''; }
    }
  }

  function beginCheck(): void {
    if (!secret) return;
    positions = backupWordPositions(shownWords.length);
    shownWords = [];
    answers = positions.map(() => '');
    visibleAnswers = positions.map(() => false);
    wrongAnswers = positions.map(() => false);
    error = '';
    phase = 'check';
  }

  async function verify(): Promise<void> {
    if (busy || !secret) return;
    if (!verifyBackupWords(secret, positions, answers)) {
      const words = new TextDecoder().decode(secret).trim().split(/\s+/);
      wrongAnswers = positions.map((position, index) => words[position] !== answers[index].trim().toLowerCase());
      error = 'Слова не совпали. Проверьте запись или покажите фразу снова.';
      return;
    }
    busy = true;
    const token = workToken;
    try {
      if (!await onVerified()) {
        if (token === workToken) error = 'Не удалось сохранить подтверждение. Повторите проверку.';
        return;
      }
      if (token !== workToken) return;
      forgetSecret();
      phase = 'success';
      error = '';
    } catch {
      if (token === workToken) error = 'Не удалось сохранить подтверждение. Повторите проверку.';
    } finally {
      if (token === workToken) busy = false;
    }
  }

  function skip(): void { forgetSecret(); onSkip(); }
  onMount(() => {
    const hide = () => {
      if (!document.hidden) return;
      forgetSecret();
      error = '';
      if (phase !== 'success') phase = 'prompt';
    };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); forgetSecret(); };
  });
</script>

<section class="backup" aria-label={$i18n.text("Резервная копия аккаунта")}>
  {#if method === 'file'}
    <EncryptedBackup {accountId} {nickname} {onVerified} {readProfiles} onClose={skip} />
  {:else}
  <h3>{phase === 'success' ? $i18n.text("Запись проверена") : $i18n.text("Сохраните seed-фразу")}</h3>
  {#if phase === 'prompt'}
    <p>{$i18n.text("Сид (seed-фраза) восстанавливает доступ к аккаунту. Для переписки нужна отдельная копия данных. Одного пароля для восстановления недостаточно.")}</p>
    <p>{$i18n.text("Запишите слова по порядку на бумаге и храните её отдельно. Никому не передавайте фразу.")}</p>
    <button type="button" onclick={start}>{$i18n.text("Показать фразу")}</button>
    {#if accountId}<button type="button" onclick={() => { forgetSecret(); method = 'file'; }}>{$i18n.text("Сохранить зашифрованный файл")}</button>{/if}
    <button type="button" onclick={skip}>{$i18n.text("Пропустить")}</button>
  {:else if phase === 'password'}
    <form onsubmit={(event) => { event.preventDefault(); void authenticate(); }}>
      <label>{$i18n.text("Пароль аккаунта")} <input type="password" bind:value={password} autocomplete="current-password" disabled={busy} /></label>
      <button type="submit" disabled={busy || !password}>{busy ? $i18n.text("Открываем…") : $i18n.text("Показать фразу")}</button>
      <button type="button" onclick={skip} disabled={busy}>{$i18n.text("Позже")}</button>
    </form>
  {:else if phase === 'words'}
    <p>{$i18n.text("Запишите все слова по порядку. Затем проверим три слова из вашей записи.")}</p>
    <SeedWords words={shownWords} />
    <p><small>{$i18n.text("При переключении вкладки фраза скроется.")}</small></p>
    <button type="button" onclick={beginCheck}>{$i18n.text("Проверить записанные слова")}</button>
    <button type="button" onclick={skip}>{$i18n.text("Позже")}</button>
  {:else if phase === 'check'}
    <p>{$i18n.text("Посмотрите в свою запись и введите указанные слова.")}</p>
    <form autocomplete="off" onsubmit={(event) => { event.preventDefault(); void verify(); }}>
      {#each positions as position, index}
        <label class="answer">{$i18n("m_6e92360582ac", {v0: (position + 1)})}
          <span class="word-input">
            <span class="masked-wrap">
              <input type="text" value={answers[index]} autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" disabled={busy}
                data-lpignore="true" data-1p-ignore data-bwignore class:masked={!visibleAnswers[index]}
                class:invalid={wrongAnswers[index] || !!answers[index] && !seedWordIsValid(answers[index])}
                aria-invalid={wrongAnswers[index] || !!answers[index] && !seedWordIsValid(answers[index])}
                oninput={(event) => { answers[index] = event.currentTarget.value.toLowerCase(); wrongAnswers[index] = false; }} />
              {#if !visibleAnswers[index]}<span class="mask" aria-hidden="true">{'•'.repeat(Math.min(answers[index].length, 32))}</span>{/if}
            </span>
          </span>
        </label>
        <button type="button" aria-label={$i18n("m_ee8746afd25d", {v0: (visibleAnswers[index] ? $i18n.text("Скрыть") : $i18n.text("Показать")), v1: (position + 1)})} aria-pressed={visibleAnswers[index]} onclick={() => visibleAnswers[index] = !visibleAnswers[index]}>👁</button>
        {#if answers[index] && !seedWordIsValid(answers[index])}<p class="typo">{$i18n.text("Такого слова нет в английском словаре seed.")}</p>{/if}
      {/each}
      <button type="submit" disabled={busy || answers.some((answer) => !answer.trim())}>{busy ? $i18n.text("Сохраняем…") : $i18n.text("Проверить запись")}</button>
      <button type="button" disabled={busy} onclick={() => { forgetSecret(); phase = 'password'; error = ''; }}>{$i18n.text("Показать фразу снова")}</button>
      <button type="button" onclick={skip} disabled={busy}>{$i18n.text("Позже")}</button>
    </form>
  {:else}
    <p>{$i18n.text("Все три слова совпали. Храните полную запись в безопасном месте.")}</p>
    <button type="button" onclick={skip}>{$i18n.text("Продолжить")}</button>
  {/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
  {/if}
</section>

<style>
  .backup { max-width:580px; padding:14px; border:1px solid var(--line-strong); margin:12px 0; }
  .answer { display:block; margin:12px 0; }
  .answer input { display:block; max-width:100%; margin-top:4px; }
  .masked-wrap { display:inline-block; position:relative; }
  .masked { color:transparent; caret-color:var(--text); }
  .mask { position:absolute; left:3px; top:7px; pointer-events:none; color:var(--text); max-width:95%; overflow:hidden; }
  .invalid { border:2px solid var(--danger); }
  .typo { color:var(--danger); font-size:.85em; margin:4px 0; }
  button { margin:4px 6px 4px 0; }
</style>
