<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import { GROUP_TEXT_BYTES, MAX_GROUP_MEMBERS } from './protocol';
  import type { GroupRooms } from './storage';

  let { rooms, self, contacts, name, connected, create, accept, send, sync, direct, close }:{
    rooms:GroupRooms; self:string; contacts:string[]; name:(peer:string)=>string;
    connected:ReadonlySet<string>;
    create:(title:string, peers:string[])=>Promise<string>; accept:(id:string)=>Promise<void>;
    send:(id:string, text:string)=>Promise<void>; sync:()=>void; direct:()=>void; close:()=>void;
  } = $props();
  let selected = $state(''), creating = $state(false), title = $state(''), peers = $state<string[]>([]);
  let draft = $state(''), busy = $state(false), failed = $state(false);
  const room = $derived(rooms.find(value => value.id === selected));
  const links = $derived(room?.members.filter(peer => connected.has(peer)).length ?? 0);
  const draftBytes = $derived(new TextEncoder().encode(draft.trim()).length);
  async function act(work: () => Promise<void>) {
    if (busy) return;
    busy = true; failed = false;
    try { await work(); } catch { failed = true; }
    finally { busy = false; }
  }
  function open(id: string) {
    selected = id; creating = false; draft = ''; failed = false; sync();
  }
</script>

<CompactDialog title={$i18n.text('Закрытые группы')} onClose={close}>
  {#if failed}<p role="alert">{$i18n.text('Действие с группой не выполнено. Проверьте подключение и попробуйте снова.')}</p>{/if}
  {#if room}
    <header>
      <button type="button" onclick={() => open('')} disabled={busy}>{$i18n.text('Все группы')}</button>
      <strong>{room.title}</strong>
      <small>{room.members.length}/{MAX_GROUP_MEMBERS} · MLS</small>
    </header>
    <p class="connection" role="status">{$i18n.text('Прямые соединения')} · {links}/{room.members.length - 1}</p>
    {#if !links}
      <p class="connection">{$i18n.text('Для поиска участников нужен общий сигналинг или прямое подключение по QR.')}</p>
      <button type="button" onclick={direct}>{$i18n.text('Прямое подключение')}</button>
    {/if}
    {#if room.mls}
      <div class="posts" role="log" aria-label={$i18n.text('Переписка группы')}>
        {#each room.entries as message (message.id)}
          <article class:own={message.from === self}>
            <strong>{message.from === self ? $i18n.text('Вы') : name(message.from)}</strong><p>{message.text}</p>
            {#if message.from === self}
              <small>{message.receivedBy?.length ? $i18n.text('Получили участники') : $i18n.text('Сохранено на этом устройстве')}
                {#if message.receivedBy?.length} · {message.receivedBy.length}/{room.members.length - 1}{/if}
              </small>
            {/if}
          </article>
        {:else}<p>{$i18n.text('Пока нет сообщений.')}</p>{/each}
      </div>
      <form class="composer" onsubmit={(event) => {
        event.preventDefault();
        if (!room || !draftBytes || draftBytes > GROUP_TEXT_BYTES) return;
        const id = room.id, value = draft;
        void act(async () => { await send(id, value); if (draft === value) draft = ''; });
      }}>
        <textarea bind:value={draft} maxlength={GROUP_TEXT_BYTES} rows="2" aria-label={$i18n.text('Сообщение группе')}></textarea>
        <button type="submit" class="primary" disabled={busy || !draftBytes || draftBytes > GROUP_TEXT_BYTES}>{$i18n.text('Отправить')}</button>
      </form>
      <button type="button" onclick={sync}>{$i18n.text('Догрузить сообщения')}</button>
    {:else if room.owner === self || room.draft}
      <p role="status">{$i18n.text('Чат откроется, когда все приглашённые примут приглашение.')}{#if room.owner === self} · {Object.keys(room.keys).length}/{room.members.length-1}{/if}</p>
      <button type="button" onclick={sync}>{$i18n.text('Обновить')}</button>
    {:else}
      <p>{name(room.owner)} · {$i18n.text('Приглашение в закрытую группу')}</p>
      <button type="button" class="primary" disabled={busy} onclick={() => void act(() => accept(room!.id))}>{$i18n.text('Вступить в группу')}</button>
    {/if}
  {:else if creating}
    <form class="create" onsubmit={(event) => {
      event.preventDefault();
      void act(async () => open(await create(title.trim(), peers)));
    }}>
      <label>{$i18n.text('Название группы')} <input bind:value={title} maxlength="60" required /></label>
      <fieldset>
        <legend>{$i18n.text('Участники группы')} · {peers.length + 1}/{MAX_GROUP_MEMBERS}</legend>
        {#each contacts as peer (peer)}
          <label><input type="checkbox" value={peer} bind:group={peers} disabled={busy || peers.length >= MAX_GROUP_MEMBERS - 1 && !peers.includes(peer)} /> {name(peer)}</label>
        {:else}<p>{$i18n.text('Для приглашения нужен подтверждённый контакт.')}</p>{/each}
      </fieldset>
      <div class="actions"><button class="primary" type="submit" disabled={busy || !title.trim() || !peers.length}>{$i18n.text('Создать группу')}</button>
        <button type="button" disabled={busy} onclick={() => open('')}>{$i18n.text('Отмена')}</button></div>
    </form>
  {:else}
    <p class="connection">{$i18n.text('Экспериментальный текстовый чат. Состав группы фиксируется при создании.')}</p>
    <div class="room-list">
      {#each rooms as item (item.id)}
        <button type="button" onclick={() => open(item.id)}><strong>{item.title}</strong>
          <small>{item.mls ? `${item.members.length}/${MAX_GROUP_MEMBERS} · MLS` : $i18n.text('Приглашение')}</small></button>
      {/each}
    </div>
    <button type="button" class="primary" onclick={() => { creating = true; title = ''; peers = []; }}>{$i18n.text('Новая закрытая группа')}</button>
  {/if}
</CompactDialog>

<style>
  header,.actions,.composer{display:flex;align-items:center;flex-wrap:wrap;gap:8px}
  header small{margin-inline-start:auto;color:var(--muted)}
  .create,.room-list,fieldset{display:grid;gap:8px;margin-bottom:12px}
  .room-list button{display:flex;justify-content:space-between;gap:10px;text-align:left;overflow-wrap:anywhere}
  .create input:not([type=checkbox]){display:block;width:100%;box-sizing:border-box}
  fieldset{max-height:32vh;overflow:auto;border:1px solid var(--line);border-radius:10px}
  .posts{overflow:auto;min-height:130px;max-height:35vh;display:flex;flex-direction:column;gap:6px;margin:12px 0;padding:8px;border:1px solid var(--line);border-radius:10px}
  article{align-self:flex-start;max-width:90%;border-radius:10px;padding:6px 9px;background:var(--surface-alt);overflow-wrap:anywhere}
  article.own{align-self:flex-end;background:var(--accent-soft)}
  article strong{font-size:.8em}article p{margin:3px 0;white-space:pre-wrap}
  article small,.connection{font-size:.85em;color:var(--muted)}
  .connection{margin:6px 0}
  .composer{margin-bottom:8px}.composer textarea{flex:1;min-width:120px;resize:vertical}
</style>
