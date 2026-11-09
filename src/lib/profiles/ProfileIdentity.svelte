<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import Avatar from '$lib/chat/Avatar.svelte';
  let { avatar, accountId = '', nickname, profile, photo = false, expanded = false, onOpen }: {
    avatar: string; accountId?: string; nickname: string; profile: string; photo?: boolean; expanded?: boolean; onOpen(): void;
  } = $props();
</script>
<button class="profile-identity" type="button" onclick={onOpen} aria-expanded={expanded}
  aria-label={$i18n("m_36d8d0f8cbb0", {v0: (nickname), v1: (profile)})} title={$i18n.text("Мой профиль")}>
  {#if accountId}<Avatar {accountId} photo={photo ? avatar : ''} size={40} />
  {:else}<img src={avatar} class:photo alt="" width="40" height="40" />{/if}
  <span><strong>{nickname}</strong><small>{profile}</small></span>
</button>
<style>
  button { display:flex; align-items:center; gap:8px; min-width:0; min-height:44px; padding:2px; border-color:transparent; background:transparent; text-align:left; flex:1 1 auto; }
  button:hover:not(:disabled) { background:transparent; border-color:transparent; }
  img { flex-shrink:0; image-rendering:pixelated; }
  img.photo { image-rendering:auto; object-fit:cover; border-radius:24%; }
  span { display:flex; flex-direction:column; min-width:0; line-height:1.25; }
  strong, small { white-space:normal;overflow-wrap:anywhere; }
  strong { font-size:15px; } small { font-size:11px; color:var(--muted); }
</style>
