<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import HelpInfo from '$lib/application/HelpInfo.svelte';
  import { MAX_PROFILE_LINKS, normalizeProfileLinks, type ProfileLink } from './profile-links';
  let { links = [], onSave }: { links?: ProfileLink[]; onSave?: (links: ProfileLink[]) => Promise<boolean> } = $props();
  let editing = $state(false), draft = $state<ProfileLink[]>([]), busy = $state(false), error = $state('');
  function edit() { draft = links.map(link => ({ ...link })); editing = true; error = ''; }
  async function save() {
    const filled = draft.filter(link => link.url.trim() || link.label.trim());
    const next = normalizeProfileLinks(filled);
    if (next.length !== filled.length) { error = 'Проверьте ссылки: нужен полный адрес http:// или https:// без логина и пароля.'; return; }
    busy = true; error = '';
    try { if (await onSave?.(next)) editing = false; else error = 'Не удалось сохранить ссылки. Повторите попытку.'; }
    catch { error = 'Не удалось сохранить ссылки. Повторите попытку.'; }
    finally { busy = false; }
  }
</script>
{#if onSave || links.length}
<section class="profile-links" aria-label={$i18n.text('Ссылки профиля')}>
  <div class="heading"><h4>{$i18n.text('Ссылки')}</h4>
    <HelpInfo label={$i18n.text('Справка: ссылки профиля')} text={$i18n.text('Ссылки указаны владельцем профиля. Принадлежность сайтов и соцсетей пока не проверяется. Они передаются принятым контактам при прямом соединении.')} />
    {#if onSave && !editing}<button class="edit" onclick={edit}>{$i18n.text('Изменить')}</button>{/if}
  </div>
  {#if editing}
    <form onsubmit={event => { event.preventDefault(); void save(); }}>
      {#each draft as link, index}
        <div class="edit-row"><label><span>{$i18n.text('Название')}</span><input bind:value={link.label} maxlength="40" placeholder={$i18n.text('Сайт или соцсеть')} disabled={busy} /></label>
          <label><span>URL</span><input type="url" bind:value={link.url} maxlength="512" placeholder="https://" disabled={busy} /></label>
          <button type="button" disabled={busy} aria-label={$i18n.text('Удалить ссылку')} onclick={() => draft = draft.filter((_, i) => i !== index)}>×</button></div>
      {/each}
      <div class="actions">{#if draft.length < MAX_PROFILE_LINKS}<button type="button" disabled={busy} onclick={() => draft = [...draft, {label:'',url:''}]}>{$i18n.text('Добавить ссылку')}</button>{/if}
        <button type="submit" class="primary" disabled={busy}>{$i18n.text('Сохранить')}</button><button type="button" disabled={busy} onclick={() => editing = false}>{$i18n.text('Отмена')}</button></div>
      {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
    </form>
  {:else}
    <ul>{#each normalizeProfileLinks(links) as link}<li><a href={link.url} target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer" title={link.url}><span>{link.label || new URL(link.url).hostname}</span><small>{new URL(link.url).hostname} ↗</small></a></li>{/each}</ul>
    {#if !links.length}<small>{$i18n.text('Добавьте сайт или соцсеть, чтобы контакты могли найти вас.')}</small>{/if}
  {/if}
</section>
{/if}
<style>
  .profile-links{container-type:inline-size;margin-top:16px;padding:14px;border:1px solid var(--line);border-radius:12px;background:var(--surface-alt);min-width:0}
  .heading,.actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.heading{margin-bottom:8px}h4{margin:0}.edit{margin-left:auto}
  ul{padding:0;margin:0;list-style:none;display:grid;gap:6px}a{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;overflow-wrap:anywhere;padding:8px 0}small{color:var(--muted);font-size:12px}
  .edit-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin:10px 0}.edit-row label:first-child{grid-column:1/-1}label{display:grid;gap:4px;min-width:0}label span{font-size:12px;color:var(--muted)}input{width:100%;box-sizing:border-box;min-width:0}button{font-size:14px;min-height:36px}.actions{margin-top:12px}p{font-size:13px}
  @container(min-width:700px){.edit-row{grid-template-columns:minmax(100px,1fr) minmax(0,2fr) auto}.edit-row label:first-child{grid-column:auto}}
  @media(pointer:coarse){input{font-size:16px}button{min-height:44px}}
</style>
