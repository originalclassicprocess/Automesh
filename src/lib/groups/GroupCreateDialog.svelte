<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import { MAX_GROUP_MEMBERS } from './protocol';

  let { contacts, name, create, open, close }: {
    contacts: string[]; name(peer: string): string;
    create(title: string, peers: string[]): Promise<string>; open(id: string): void; close(): void;
  } = $props();
  let title = $state(''), peers = $state<string[]>([]);
  let busy = $state(false), failed = $state(false);

  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (busy || !title.trim() || !peers.length) return;
    busy = true;
    failed = false;
    try { open(await create(title.trim(), peers)); }
    catch { failed = true; }
    finally { busy = false; }
  }
</script>

<CompactDialog title={$i18n.text('Новая закрытая группа')} onClose={() => { if (!busy) close(); }}>
  <form onsubmit={submit}>
    <label>{$i18n.text('Название группы')} <input bind:value={title} maxlength="60" required disabled={busy} /></label>
    <fieldset>
      <legend>{$i18n.text('Участники группы')} · {peers.length + 1}/{MAX_GROUP_MEMBERS}</legend>
      {#each contacts as peer (peer)}
        <label><input type="checkbox" value={peer} bind:group={peers} disabled={busy || peers.length >= MAX_GROUP_MEMBERS - 1 && !peers.includes(peer)} /> {name(peer)}</label>
      {:else}<p>{$i18n.text('Для приглашения нужен подтверждённый контакт.')}</p>{/each}
    </fieldset>
    {#if failed}<p role="alert">{$i18n.text('Действие с группой не выполнено. Проверьте подключение и попробуйте снова.')}</p>{/if}
    <div class="actions">
      <button class="primary" type="submit" disabled={busy || !title.trim() || !peers.length}>{$i18n.text('Создать группу')}</button>
      <button type="button" disabled={busy} onclick={close}>{$i18n.text('Отмена')}</button>
    </div>
  </form>
</CompactDialog>

<style>
  form, fieldset { display:grid; gap:8px; }
  input:not([type=checkbox]) { display:block; width:100%; box-sizing:border-box; }
  fieldset { max-height:32vh; overflow:auto; border:1px solid var(--line); border-radius:10px; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; }
</style>
