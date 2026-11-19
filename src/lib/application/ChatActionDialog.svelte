<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import Avatar from '$lib/chat/Avatar.svelte';
  let { mode, rows, busy, error, onConfirm, onClose }: {
    mode: 'forward' | 'contact' | 'delete'; rows: { id: string; name: string; photo?:string }[];
    busy: boolean; error: string; onConfirm: (ids: string[]) => void; onClose: () => void;
  } = $props();
  let chosen = $state<string[]>([]); let query = $state(''); let dialog: HTMLDialogElement;
  const visible = $derived(rows.filter(row => `${row.name} ${row.id}`.toLowerCase().includes(query.toLowerCase())));
  onMount(() => { const previous = document.activeElement as HTMLElement | null; dialog.showModal();
    return () => { dialog.close(); previous?.focus(); }; });
</script>
<dialog bind:this={dialog} aria-label={mode === 'forward' ? $i18n.text("Переслать в чаты") : mode === 'contact' ? $i18n.text("Поделиться контактом") : $i18n.text("Удалить сообщения")} oncancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
  <h3>{mode === 'forward' ? $i18n.text("Переслать в чаты") : mode === 'contact' ? $i18n.text("Поделиться контактом") : $i18n.text("Удалить выбранные сообщения?")}</h3>
  {#if mode === 'delete'}
    <p>{$i18n.text("Только у вас на этом устройстве, вместе с вложениями. Копии собеседников не изменятся. Это нельзя отменить.")}</p>
  {:else}
    <input aria-label={$i18n.text("Поиск в списке")} placeholder={$i18n.text("Поиск")} bind:value={query} disabled={busy} />
    <div class="choices">
      {#each visible as row (row.id)}
        <label><input type={mode === 'contact' ? 'radio' : 'checkbox'} name="chat-destination" checked={chosen.includes(row.id)} disabled={busy}
          onchange={(event) => chosen = mode === 'contact' ? [row.id] : event.currentTarget.checked ? [...chosen, row.id] : chosen.filter(id => id !== row.id)} />
          <Avatar accountId={row.id} photo={row.photo} size={36}/><span class="target-text"><strong>{row.name}</strong><small>{row.id}</small></span></label>
      {/each}
    </div>
    {#if mode === 'forward'}<small>{$i18n("m_7ad269ee1257", {v0: (chosen.length)})}</small>{/if}
  {/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
  <footer><button onclick={() => onConfirm(chosen)} disabled={busy || (mode !== 'delete' && !chosen.length)}>
    {busy ? $i18n.text("Обрабатываем…") : mode === 'forward' ? $i18n.text("Переслать") : mode === 'contact' ? $i18n.text("Отправить контакт") : $i18n.text("Удалить у меня")}</button>
    <button onclick={onClose} disabled={busy}>{$i18n.text("Отмена")}</button></footer>
</dialog>
<style>
  dialog { width:min(480px, calc(100vw - 40px)); max-height:80vh; border:1px solid var(--line-strong); border-radius:12px; box-sizing:border-box; }
  dialog::backdrop { background:var(--overlay); } h3 { margin-top:0; } input:not([type]) { width:100%; box-sizing:border-box; }
  .choices { max-height:45vh; overflow:auto; margin:12px 0; } label { display:flex; align-items:center; gap:10px; padding:8px; min-height:52px; } .target-text { min-width:0; } .target-text strong { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; } .target-text small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  small { display:block; opacity:.7; font-size:12px; } footer { display:flex; gap:8px; margin-top:12px; }
</style>
