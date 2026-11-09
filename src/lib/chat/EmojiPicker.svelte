<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  let { onChoose, onClose }: { onChoose(value: string): void; onClose(): void } = $props();
  const groups = [
    { name:'Лица', items:'😀 😃 😄 😁 😆 😅 😂 🤣 🙂 🙃 😉 😊 😇 🥰 😍 🤩 😘 😋 😛 😜 🤪 🤔 🤨 😐 🙄 😏 😔 😴 😢 😭 😤 😡 🤯 😱 🥳 😎 🤓 🫡' },
    { name:'Жесты', items:'👍 👎 👏 🙌 👐 🤝 🙏 💪 👋 ✋ 🤞 ✌️ 🤟 👌 🫶 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 💔 💕 💯 ✅ ❌ ❓ ❗' },
    { name:'Разное', items:'🔥 ✨ ⭐ 🎉 🎊 🎁 🎂 🎈 🌞 🌙 🌈 🌸 🌹 🍀 🐶 🐱 🐾 ☕ 🍕 🍎 🍻 🏠 🚗 ✈️ 🚀 💻 📱 📷 🎵 🎮 ⚽ 🏆 💡 📌 ⏰' }
  ];
  let tab = $state(0);
</script>
<section class="emoji-picker" aria-label={$i18n.text("Эмодзи")}>
  <header><div>{#each groups as group, i}<button class:active={tab === i} onclick={() => tab = i}>{$i18n.text(group.name)}</button>{/each}</div><button onclick={onClose} aria-label={$i18n.text("Закрыть эмодзи")}>✕</button></header>
  <div class="emoji-grid">{#each groups[tab].items.split(' ') as emoji}<button onclick={() => onChoose(emoji)} aria-label={$i18n("m_c6c06093a4e7", {v0: (emoji)})}>{emoji}</button>{/each}</div>
</section>
<style>
  .emoji-picker { border:1px solid var(--line); border-radius:12px; background:var(--surface); padding:8px; max-height:250px; overflow:auto; }
  header, header div { display:flex; gap:4px; align-items:center; } header { justify-content:space-between; }
  header button { font-size:12px; padding:6px; } .active { background:var(--accent-soft); }
  .emoji-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(36px,1fr)); gap:2px; padding-top:6px; }
  .emoji-grid button { border:0; background:transparent; font-size:24px; padding:4px; min-height:36px; }
  .emoji-grid button:hover { background:var(--accent-soft); }
</style>
