<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type { ProfileEntry } from '../core/profiles';
  import { onMount } from 'svelte';
  import { ALL_CHATS_VIEW } from './presets';
  import { PROFILE_FEATURES } from './features';
  import UnlockPasswordField from '../vault/UnlockPasswordField.svelte';
  import { AutoUnlock } from '../application/auto-unlock';
  import Avatar from '../chat/Avatar.svelte';
  let { profiles, activeId, activePhoto = '', trusted, busy = false, requestedId = '', allChats = false, inline = false, onDismiss, onSwitch, onManage, onAccount }: {
    profiles: ProfileEntry[]; activeId: string; trusted: boolean; busy?: boolean;
    onSwitch(id: string, password: string, current?: () => boolean): Promise<boolean>; onManage(): void;
    inline?: boolean; activePhoto?: string;
    requestedId?: string; allChats?: boolean; onDismiss?(): void; onAccount?(): void;
  } = $props();
  let open = $state(false), inlineOpen=$state(false), choice = $state(''), password = $state(''), submitting = $state(false);
  let error = $state('');
  const auto = new AutoUnlock((entered, current) => submit(entered, current));
  $effect(() => { const entered = password; const target = choice;
    if (entered && target && (inline ? inlineOpen : open)) auto.schedule(entered); else auto.cancel();
    return () => auto.cancel();
  });
  function close() { auto.cancel(); open = false;inlineOpen=false; choice = ''; password = ''; error = ''; onDismiss?.(); }
  $effect(() => { if (requestedId) { choice = requestedId; password = ''; error = ''; open = true;inlineOpen=true; } });
  onMount(() => { const hide = () => { if (document.hidden) close(); }; document.addEventListener('visibilitychange',hide);
    return () => { auto.cancel(); document.removeEventListener('visibilitychange',hide); password = ''; choice = ''; }; });
  function modal(node: HTMLDialogElement) { node.showModal(); return { destroy() { node.close(); } }; }
  async function submit(entered = password, current: () => boolean = () => true) {
    if (submitting || busy || !entered || !choice || !current()) return;
    const target = choice; const isCurrent = () => current() && choice === target && (inline ? inlineOpen : open);
    error = ''; submitting = true;
    try { if (await onSwitch(target, entered, isCurrent)) close(); else if (isCurrent()) error = 'Переход не выполнен. Проверьте пароль и сохранённую историю; прежний профиль не закрыт.'; }
    catch { error = 'Переход не выполнен. Повторите попытку.'; }
    finally { password = ''; submitting = false; }
  }
</script>
{#snippet content()}
  <h3>{$i18n.text("Мои профили")}</h3>
  {#if trusted && profiles.length}
    <div class="profile-list">
      {#each profiles.filter(p => !p.archived && p.role !== 'main') as p}
        <button type="button" aria-current={p.id === activeId} aria-pressed={choice === p.id} disabled={busy || submitting}
          onclick={() => { auto.cancel(); password = ''; error = ''; choice = p.id === activeId ? '' : p.id; }}>
          <Avatar accountId={p.accountId} photo={p.id === activeId ? activePhoto : ''} size={28} />
          {p.name}{#if p.id === activeId}<small> {$i18n.text("· текущий")}</small>{/if}
        </button>
      {/each}
    </div>
    {#if choice}
      <form onsubmit={event => { event.preventDefault(); auto.cancel(); void submit(); }}>
        {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
        <UnlockPasswordField id="profile-password" bind:value={password} disabled={busy || submitting} />
        <small>{$i18n.text("Верный пароль откроет профиль автоматически.")}</small>
        <button disabled={busy || submitting || !password}>{busy || submitting ? $i18n.text("Открываем…") : $i18n.text("Открыть профиль")}</button>
      </form>
    {:else if error}<p role="alert">{$i18n.text(error)}</p>{/if}
  {:else}<p>{trusted ? $i18n.text("Создайте профиль в настройках аккаунта.") : $i18n.text("Переключение профилей доступно в доверенном режиме.")}</p>{/if}
  <button disabled={busy || submitting} onclick={() => { close(); onManage(); }}>{$i18n.text("Добавить или настроить профиль")}</button>
{/snippet}
{#if inline}
  <details class="profile-group" bind:open={inlineOpen} ontoggle={event=>{if(!event.currentTarget.open){auto.cancel();choice='';password='';onDismiss?.();}}}><summary>{$i18n.text("Другие профили")}</summary><section aria-label={$i18n.text("Мои профили")}>{@render content()}</section></details>
{:else}
<button type="button" disabled={busy} onclick={() => { choice = PROFILE_FEATURES.advancedInbox && (allChats || profiles.find(p => p.id === activeId)?.role === 'main') ? ALL_CHATS_VIEW : profiles.find(p => p.id === activeId && !p.archived && p.role !== 'main')?.id || profiles.find(p => !p.archived && p.role !== 'main')?.id || ''; error = ''; open = true; }}
  title={$i18n.text("Выбрать адрес для общения")} aria-label={$i18n.text("Выбрать профиль")}><span>{profiles.find(p => p.id === activeId)?.role === 'main' ? $i18n.text("Выберите профиль") : profiles.find(p => p.id === activeId)?.name || $i18n.text("Личный")}</span></button>
{#if open}
  <dialog use:modal oncancel={event => { if (submitting || busy) event.preventDefault(); else close(); }} aria-label={$i18n.text("Выбор профиля")}>
    {@render content()}
    {#if onAccount}<button disabled={busy || submitting} onclick={() => { close(); onAccount(); }}>{$i18n.text("Мой аккаунт")}</button>{/if}
    <button disabled={busy || submitting} onclick={close}>{$i18n.text("Закрыть")}</button>
  </dialog>
{/if}
{/if}
<style>
  .profile-group{font-size:13px;color:var(--muted)}.profile-group summary{min-height:32px;cursor:pointer;padding:6px 36px 6px 0;box-sizing:border-box}.profile-group section{padding:4px 0 12px}
  dialog { width:min(480px,calc(100vw - 32px)); max-height:calc(100dvh - 48px); overflow:auto; padding:20px; border:1px solid var(--border); border-radius:16px; }
  dialog::backdrop { background:var(--overlay); }
  form { display:grid; gap:8px; margin:16px 0; }
  button { margin:4px; } small { color:var(--muted); }
  .profile-list { display:flex; flex-wrap:wrap; gap:6px; } .profile-list button { display:flex; align-items:center; gap:6px; margin:0; min-height:44px; }
</style>
