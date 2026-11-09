<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  let { value = $bindable(''), disabled = false, id, onChange = () => {} }: {
    value: string; id: string; disabled?: boolean; onChange?(): void;
  } = $props();
  let visible = $state(false);
</script>
<label for={id}>{$i18n.text("Пароль аккаунта")}</label>
<div class="unlock-password">
  <input {id} name="password" type={visible ? 'text' : 'password'} autocomplete="current-password"
    bind:value {disabled} required oninput={onChange} />
  <button type="button" {disabled} aria-label={visible ? $i18n.text("Скрыть пароль") : $i18n.text("Показать пароль")} aria-pressed={visible} onclick={() => visible = !visible}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
      {#if visible}<path d="m3 3 18 18" />{/if}
    </svg>
  </button>
</div>
<style>
  label { display:block; margin-top:12px; }
  .unlock-password { display:flex; gap:6px; align-items:center; }
  input { flex:1; min-width:0; width:100%; }
  button { display:grid; place-items:center; width:44px; min-height:44px; flex-shrink:0; padding:6px; }
</style>
