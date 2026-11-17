<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type { MediaLibrary, MediaAsset, StickerPack } from './media-library';
  let { onChoose, onClose, library, load, onSend, onManage, canSend = false, busy = false }:
    { onChoose(value: string): void; onClose(): void; library?: MediaLibrary;
      load?(hash: string): Promise<Uint8Array | null>; onSend?(asset: MediaAsset, pack?: StickerPack): Promise<void>;
      onManage?(tab: 'stickers' | 'gifs'): void; canSend?: boolean; busy?: boolean } = $props();
  const groups = [
    { name:'Лица', items:'😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤔 🤨 😐 🙄 😏 😔 😴 😢 😭 😤 😡 🤯 😱 🥳 😎 🤓 🫡' },
    { name:'Жесты', items:'👍 👎 👏 🙌 👐 🤝 🙏 💪 👋 ✋ 🤞 ✌️ 🤟 👌 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💯 ✅ ❌ ❓ ❗' },
    { name:'Разное', items:'🔥 ✨ ⭐ 🎉 🎊 🎁 🎂 🎈 🌞 🌙 🌈 🌸 🌹 🍀 🐶 🐱 🐾 ☕ 🍕 🍎 🍻 🏠 🚗 ✈️ 🚀 💻 📱 📷 🎵 🎮 ⚽ 🏆 💡 📌 ⏰' }
  ];
  let tab = $state(0);
  let mode = $state<'emoji' | 'stickers' | 'gifs'>('emoji');
  let selectedPack = $state(''), limit = $state(60), sending = $state(false), error = $state('');
  let urls = $state<Record<string, string>>({});
  const pack = $derived(library?.packs.find(p => p.id === selectedPack));
  const assets = $derived.by(() => {
    if (!library || mode === 'emoji') return [];
    const hashes = new Set(mode === 'gifs' ? library.gifs : pack ? pack.assets : library.packs.flatMap(p => p.assets));
    const ordered = mode === 'stickers' && pack ? pack.assets.map(hash => library.assets.find(a => a.hash === hash)).filter((a): a is MediaAsset => !!a) : library.assets.filter(a => hashes.has(a.hash));
    return mode === 'stickers' && !pack ? ordered.filter(a => a.favorite) : ordered;
  });
  $effect(() => {
    const shown = [...new Map([...assets.slice(0, limit), ...(mode === 'stickers' ? library?.packs.map(p => library.assets.find(a => a.hash === p.assets[0])).filter((a): a is MediaAsset => !!a) ?? [] : [])].map(a => [a.hash, a])).values()];
    const read = load, created: string[] = []; let alive = true;
    urls = {};
    if (read) void (async () => {
      for (const asset of shown) {
        try {
          const bytes = await read(asset.hash); if (!alive) return; if (!bytes) continue;
          const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: asset.mime })); created.push(url);
          urls = { ...urls, [asset.hash]: url };
        } catch { /* A missing local file stays unavailable, without a network fetch. */ }
      }
    })();
    return () => { alive = false; created.forEach(url => URL.revokeObjectURL(url)); };
  });
  function chooseMode(value: typeof mode) { mode = value; selectedPack = ''; limit = 60; error = ''; }
  async function send(asset: MediaAsset) {
    if (!onSend || !canSend || busy || sending) return;
    sending = true; error = '';
    try { await onSend(asset, mode === 'stickers' ? pack ?? library?.packs.find(p => p.assets.includes(asset.hash)) : undefined); }
    catch (e) { error = e instanceof Error ? e.message : 'Не удалось выполнить действие.'; }
    finally { sending = false; }
  }
</script>
<section class="emoji-picker" class:with-media={!!library} aria-label={$i18n.text(library ? 'Эмодзи, стикеры и GIF' : 'Эмодзи')}>
  <header>
    {#if library}<div role="group" aria-label={$i18n.text('Вид библиотеки')}>
      <button disabled={busy || sending} class:active={mode === 'emoji'} aria-pressed={mode === 'emoji'} onclick={() => chooseMode('emoji')}>{$i18n.text('Эмодзи')}</button>
      <button disabled={busy || sending} class:active={mode === 'stickers'} aria-pressed={mode === 'stickers'} onclick={() => chooseMode('stickers')}>{$i18n.text('Стикеры')}</button>
      <button disabled={busy || sending} class:active={mode === 'gifs'} aria-pressed={mode === 'gifs'} onclick={() => chooseMode('gifs')}>GIF</button>
    </div>{:else}<div>{#each groups as group, i}<button class:active={tab === i} onclick={() => tab = i}>{$i18n.text(group.name)}</button>{/each}</div>{/if}
    <button disabled={busy || sending} onclick={onClose} aria-label={$i18n.text('Закрыть')}>✕</button>
  </header>
  {#if mode === 'emoji'}
    {#if library}<div class="groups">{#each groups as group, i}<button class:active={tab === i} onclick={() => tab = i}>{$i18n.text(group.name)}</button>{/each}</div>{/if}
    <div class="emoji-grid">{#each groups[tab].items.split(' ') as emoji}<button onclick={() => onChoose(emoji)} aria-label={$i18n("m_c6c06093a4e7", {v0: (emoji)})}>{emoji}</button>{/each}</div>
  {:else}
    {#if mode === 'stickers'}<div class="pack-strip" role="group" aria-label={$i18n.text('Выбрать набор')}>
      <button disabled={busy || sending} class:active={!pack} aria-pressed={!pack} onclick={() => { selectedPack = ''; limit = 60; }}>★ {$i18n.text('Избранное')}</button>
      {#each library?.packs ?? [] as item (item.id)}<button disabled={busy || sending} title={item.name} class:active={pack?.id === item.id} aria-pressed={pack?.id === item.id} onclick={() => { selectedPack = item.id; limit = 60; }}>
        {#if urls[item.assets[0]]}<img src={urls[item.assets[0]]} alt="" />{/if}<span>{item.name}</span>
      </button>{/each}
    </div>{/if}
    {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
    <div class="media-scroll">
      {#if !assets.length}<p class="empty">{$i18n.text(mode === 'gifs' ? 'Добавьте GIF с устройства.' : pack ? 'В этом наборе пока нет стикеров.' : 'Пока нет избранных стикеров. Выберите набор выше или добавьте свой.')}</p>{/if}
      <div class="media-grid">{#each assets.slice(0, limit) as asset (asset.hash)}
        <button disabled={busy || sending || !canSend || !urls[asset.hash]} onclick={() => void send(asset)} aria-label={$i18n.text('Отправить') + ' ' + asset.name} title={asset.name}>
          {#if urls[asset.hash]}<img src={urls[asset.hash]} alt={asset.name} loading="lazy" />{:else}<span>…</span>{/if}
        </button>
      {/each}</div>
      {#if assets.length > limit}<button onclick={() => limit += 60}>{$i18n.text('Показать ещё')}</button>{/if}
    </div>
    {#if onManage}<button class="manage" disabled={busy || sending} onclick={() => onManage?.(mode === 'gifs' ? 'gifs' : 'stickers')}>{$i18n.text(mode === 'gifs' ? 'Добавить GIF' : 'Добавить или изменить наборы')}</button>{/if}
  {/if}
</section>
<style>
  .emoji-picker { border:1px solid var(--line); border-radius:12px; background:var(--surface); padding:8px; max-height:250px; overflow:auto; }
  header, header div { display:flex; gap:4px; align-items:center; } header { justify-content:space-between; }
  header button { font-size:12px; padding:6px; } .active { background:var(--accent-soft); }
  .emoji-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(36px,1fr)); gap:2px; padding-top:6px; }
  .emoji-grid button { border:0; background:transparent; font-size:24px; padding:4px; min-height:36px; }
  .emoji-grid button:hover { background:var(--accent-soft); }
  .with-media { display:flex; flex-direction:column; gap:6px; max-height:min(360px,44dvh); overflow:hidden; min-width:0; }
  .with-media header { flex-shrink:0; gap:4px; } .with-media header div { flex-wrap:wrap; }
  .groups { display:flex; gap:4px; } .groups button { font-size:12px; padding:5px 8px; }
  .with-media .emoji-grid { overflow:auto; min-height:0; padding-top:0; }
  .pack-strip { display:flex; gap:5px; overflow-x:auto; flex-shrink:0; padding:2px 0 5px; }
  .pack-strip button { display:flex; align-items:center; gap:5px; flex-shrink:0; max-width:150px; padding:5px 8px; min-height:38px; font-size:12px; }
  .pack-strip img { width:30px; height:30px; object-fit:contain; } .pack-strip span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .media-scroll { overflow:auto; min-height:0; } .media-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(72px,1fr)); gap:5px; }
  .media-grid button { height:82px; min-width:0; border:0; border-radius:8px; padding:3px; background:transparent; }
  .media-grid button:hover { background:var(--accent-soft); } .media-grid img { max-width:100%; max-height:76px; object-fit:contain; }
  .empty { margin:8px 2px; color:var(--muted); font-size:13px; } .manage { flex-shrink:0; align-self:flex-start; font-size:12px; padding:6px 9px; }
  [role='alert'] { color:var(--danger); font-size:13px; margin:0; }
</style>
