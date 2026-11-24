<script module lang="ts">
  export type NewChatAction = 'group' | 'contact' | 'agent' | 'radio';
  export type NewChatView = 'menu' | NewChatAction | '';
  export function newChatViewFromLayer(layer: string): NewChatView {
    const value = layer.startsWith('new-chat-') ? layer.slice(9) : '';
    return value === 'menu' || value === 'group' || value === 'contact' || value === 'agent' || value === 'radio' ? value : '';
  }
</script>

<script lang="ts">
  import { tick } from 'svelte';
  import { tr as i18n } from '$lib/i18n/language';
  import ChatIcon from './ChatIcon.svelte';

  let { expanded, disabled, groupsAvailable, toggle, close, choose }: {
    expanded: boolean; disabled: boolean; groupsAvailable: boolean;
    toggle(): void; close(): void; choose(action: NewChatAction): void;
  } = $props();
  const menuId = $props.id();
  let root: HTMLDivElement, trigger: HTMLButtonElement;
  let panel = $state<HTMLDivElement>();
  function select(action: NewChatAction) {
    trigger.focus({ preventScroll:true });
    choose(action);
  }
  $effect(() => {
    if (!expanded) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !root.contains(document.activeElement)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
      trigger.focus({ preventScroll:true });
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  });
</script>

<div class="new-chat-menu" bind:this={root}>
  <button type="button" class="primary trigger" bind:this={trigger} {disabled} aria-expanded={expanded}
    aria-controls={expanded ? menuId : undefined} aria-label={$i18n.text('Новое сообщение')} title={$i18n.text('Новое сообщение')}
    onclick={async () => {
      const opening = !expanded;
      toggle();
      await tick();
      if (opening) panel?.querySelector('button')?.focus({ preventScroll:true });
      else trigger.focus({ preventScroll:true });
    }}>
    <ChatIcon name={expanded ? 'close' : 'compose'} />
  </button>
  {#if expanded}
    <div class="actions" id={menuId} bind:this={panel} role="group" aria-label={$i18n.text('Новое сообщение')}>
      {#if groupsAvailable}
        <button type="button" onclick={() => select('group')}><ChatIcon name="group" /><span>{$i18n.text('Создать группу')}</span></button>
      {/if}
      <button type="button" onclick={() => select('contact')}><ChatIcon name="chat" /><span>{$i18n.text('Написать контакту')}</span></button>
      <button type="button" onclick={() => select('agent')}><strong aria-hidden="true">AI</strong><span>{$i18n.text('Создать ИИ-чат')}</span></button>
      <button type="button" onclick={() => select('radio')}><ChatIcon name="radio" /><span>{$i18n.text('Вступить в LoRa-канал')}</span></button>
    </div>
  {/if}
</div>

<style>
  .new-chat-menu { position:absolute; inset-inline:0 16px; bottom:8px; z-index:4; display:flex; justify-content:flex-end; pointer-events:none; }
  .trigger, .actions { pointer-events:auto; }
  .trigger { display:grid; place-items:center; width:52px; height:52px; padding:0; border-radius:50%; box-shadow:var(--shadow); }
  .actions { position:absolute; inset-inline-end:0; bottom:calc(100% + 8px); width:min(226px, 100%); padding:6px; box-sizing:border-box; border:1px solid var(--line); border-radius:14px; background:var(--surface); box-shadow:var(--shadow); }
  .actions button { display:flex; align-items:center; gap:9px; width:100%; min-height:44px; padding:8px; text-align:start; border:0; background:transparent; }
  .actions button:hover, .actions button:focus-visible { background:var(--accent-soft); }
  .actions button :global(svg), .actions strong { width:22px; flex:none; color:var(--accent); }
  .actions strong { text-align:center; font-size:13px; }
  @media(max-width:700px) { .new-chat-menu { inset-inline-end:4px; } }
</style>
