<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import Avatar from './Avatar.svelte';
  import ChatIcon from './ChatIcon.svelte';

  type NewChatChoice = { id: string; label: string; photo?: string; detail?: string };
  let { title, choices, empty, kind, loading = false, blocked = false, setup, select, close }: {
    title: string; choices: NewChatChoice[]; empty: string; kind: 'contact' | 'agent' | 'radio';
    loading?: boolean; blocked?: boolean; setup?: { label: string; run(): void };
    select(id: string): void; close(): void;
  } = $props();
  let query = $state('');
  const visible = $derived(choices.filter(choice => kind !== 'contact' ||
    `${choice.label} ${choice.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())));
</script>

<CompactDialog {title} literalTitle onClose={close}>
  {#if kind === 'contact' && choices.length}
    <input type="search" bind:value={query} aria-label={$i18n.text('Поиск')} placeholder={$i18n.text('Поиск')} />
  {/if}
  {#if loading}
    <p role="status">{$i18n.text('Подождите…')}</p>
  {:else}
    <div class="choices">
      {#each visible as choice (choice.id)}
        <button type="button" onclick={() => select(choice.id)} disabled={blocked}>
          {#if kind === 'contact'}<Avatar accountId={choice.id} photo={choice.photo} size={32} />
          {:else if kind === 'radio'}<ChatIcon name="radio" />{/if}
          <span><strong>{choice.label}</strong>{#if choice.detail}<small>{choice.detail}</small>{/if}</span>
        </button>
      {:else}
        <p>{$i18n.text(query.trim() ? 'Ничего не найдено.' : empty)}</p>
      {/each}
    </div>
  {/if}
  {#if setup}<button type="button" disabled={blocked} onclick={setup.run}>{$i18n.text(setup.label)}</button>{/if}
</CompactDialog>

<style>
  input { width:100%; box-sizing:border-box; margin-bottom:8px; }
  .choices { display:grid; gap:4px; overflow:auto; max-height:min(420px,50dvh); }
  .choices:not(:empty) { margin-bottom:8px; }
  .choices button { display:flex; align-items:center; gap:9px; min-height:44px; text-align:start; }
  .choices button span { display:grid; min-width:0; overflow-wrap:anywhere; }
  small, p { color:var(--muted); }
  p { margin:4px 0; font-size:14px; }
</style>
