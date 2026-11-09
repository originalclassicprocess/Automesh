<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { language } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import { generatePassword, MIN_NEW_PASSWORD_LENGTH, passwordPolicyError } from './password-policy';
  import { passwordStrength, type PasswordStrength } from './password-strength';
  let { value = $bindable(''), id, label = 'Пароль', name = 'password', nickname = '', disabled = false, required = false, onChange = () => {} }: {
    value: string; id: string; label?: string; name?: string; nickname?: string; disabled?: boolean; required?: boolean; onChange?: () => void;
  } = $props();
  let visible = $state(false);
  let strength = $state<PasswordStrength | null>(null);
  let evaluating = $state(false);
  let unavailable = $state(false);
  let generationError = $state('');
  const policyError = $derived(value ? passwordPolicyError(value) : null);
  const help = $derived($i18n.text('Пароль никуда не передаётся. Чем длиннее и менее предсказуем пароль, тем лучше. Минимум 10 символов; рекомендуем 15+. Генератор создаёт 24 случайных символа — сохраните их в менеджере паролей. Красный — слабый, зелёный — сильный. Оценка локальная, не гарантия защиты.') +
    (strength ? ` ${$i18n.text(`Сейчас: ${$i18n.text(strength.label)}.`)}` : '') +
    (strength?.warning ? ` ${strength.warning}` : '') +
    (strength && strength.score < 3 && strength.suggestions[0] ? ` ${strength.suggestions[0]}` : '') +
    (unavailable ? ` ${$i18n.text('Оценка сейчас недоступна; используйте длинный случайный пароль.')}` : ''));
  const colors = ['var(--danger)', 'var(--warning)', 'var(--warning)', 'var(--accent)', 'var(--success)'];
  onMount(() => {
    const hide = () => { if (document.hidden) visible = false; };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  });
  $effect(() => {
    const password = value; const personal = nickname; const feedbackLanguage=$language==='ru'?'ru':'en';
    let current = true;
    strength = null; unavailable = false; evaluating = !!password;
    const timer = setTimeout(() => {
      if (!password || !current) return;
      void passwordStrength(password, personal, feedbackLanguage).then(result => {
        if (current) strength = result;
      }).catch(() => { if (current) unavailable = true; }).finally(() => { if (current) evaluating = false; });
    }, 250);
    return () => { current = false; clearTimeout(timer); };
  });
  function generate() {
    try { value = generatePassword(); generationError = ''; onChange(); }
    catch { generationError = 'Не удалось получить безопасную случайность. Введите свой пароль.'; }
  }
</script>
<div class="password-field">
  <label for={id}>{$i18n.text(label)}</label>
  <div class="input-row">
    <input {id} {name} type={visible ? 'text' : 'password'} bind:value autocomplete="new-password"
      minlength={MIN_NEW_PASSWORD_LENGTH} {required} {disabled} placeholder={$i18n.text("От 10 символов")}
      aria-describedby={`${id}-strength`} oninput={() => { generationError = ''; onChange(); }} />
    <button class="visibility-toggle" type="button" {disabled} onclick={() => visible = !visible} aria-pressed={visible}
      aria-label={visible ? $i18n.text("Скрыть пароль") : $i18n.text("Показать пароль")} title={visible ? $i18n.text("Скрыть пароль") : $i18n.text("Показать пароль")}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
        {#if visible}<path d="m3 3 18 18" />{/if}
      </svg>
    </button>
  </div>
  <div class="generator-row">
    <button class="generate" type="button" {disabled} onclick={generate}>{$i18n.text("Сгенерировать")}</button>
    <HelpInfo label={$i18n.text("Справка: генератор и стойкость пароля")} text={help} />
  </div>
  <div id={`${id}-strength`} class="strength" aria-live="polite">
    {#if value}
      {#if policyError}<p class="warning">{$i18n.text(policyError)}</p>{/if}
      {#if strength}
        <div class="strength-bar" role="meter" aria-valuemin="0" aria-valuemax="4" aria-valuenow={strength.score}
          aria-valuetext={$i18n.text(strength.label)} aria-label={$i18n.text("Стойкость пароля")} title={$i18n.text(strength.label)} style:--strength-color={colors[strength.score]}>
          {#each [0, 1, 2, 3, 4] as index}<span class:filled={index <= strength.score}></span>{/each}
        </div>
      {:else if evaluating}<span class="pending" aria-label={$i18n.text("Оценка стойкости…")}>•••</span>
      {:else if unavailable}<span class="pending" title={$i18n.text("Оценка недоступна")}>?</span>{/if}
    {/if}
    {#if generationError}<p class="warning">{$i18n.text(generationError)}</p>{/if}
  </div>
</div>
<style>
  .password-field { margin:10px 0; max-width:560px; }
  label { display:block; margin-bottom:5px; }
  .input-row { display:flex; gap:6px; align-items:center; }
  input { width:100%; min-width:0; box-sizing:border-box; }
  .visibility-toggle { display:grid; place-items:center; flex-shrink:0; width:38px; height:38px; padding:8px; }
  @media(pointer:coarse) { .visibility-toggle { width:44px; height:44px; } }
  .generator-row { display:flex; align-items:baseline; gap:7px; margin-top:7px; }
  .generate { font-size:13px; flex-shrink:0; }
  .strength { font-size:13px; color:var(--muted); overflow-wrap:anywhere; }
  .strength p { margin:5px 0; }
  .strength-bar { display:flex; gap:3px; width:110px; margin-top:8px; }
  .strength-bar span { flex:1; height:5px; border-radius:3px; background:var(--line); }
  .strength-bar .filled { background:var(--strength-color); }
  .pending { display:block; height:5px; margin-top:8px; line-height:5px; }
  .warning { color:var(--danger); }
</style>
