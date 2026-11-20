<script lang="ts">
  import AgentSettingsPanel from '$lib/agents/AgentSettings.svelte';
  import AgentChatControls from '$lib/agents/AgentChatControls.svelte';
  import { emptyAgentSettings, normalizeAgentSettings, type AgentSettings } from '$lib/agents/model';
  let settings = $state<AgentSettings>(emptyAgentSettings());
  let notice = $state(''), automatic = $state(false), keyPresent = $state(false), working = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  function stop() { clearTimeout(timer); working = false; notice = ''; }
  async function save(value: AgentSettings, key: string) {
    settings = normalizeAgentSettings(value); automatic = false; keyPresent = Boolean(key); notice = 'Настройки ИИ сохранены.'; return true;
  }
  async function test(_value: AgentSettings, _key: string) {
    working = true; notice = ''; clearTimeout(timer); timer = setTimeout(() => { working = false; notice = 'Модель доступна. Проверка прошла успешно.'; }, 800); return true;
  }
</script>

<svelte:head><title>AI interface preview</title></svelte:head>
<main>
  <header><h2>AI interface preview</h2><p>Mock settings and chat, no account, storage or network requests.</p></header>
  <section class="account-shell settings-surface"><div class="settings-section">
    <AgentSettingsPanel {settings} busy={false} {working} {notice} {keyPresent} {automatic} {save} {test} {stop} forgetKey={() => { keyPresent = false; automatic = false; }} revokeAuto={() => automatic = false} />
  </div></section>
  <section class="account-shell chat-preview"><h3>Chat preview</h3>
    <AgentChatControls {working} disabled={false} canDraft={true} {automatic} remaining={20} {notice} draft={() => { void test(settings, ''); }} {stop} toggleAuto={() => automatic = !automatic} />
    <textarea rows="2" placeholder="Message"></textarea><button type="button" class="primary">Send</button>
  </section>
</main>

<style>
  main { max-width:760px; margin:16px auto; padding:0 12px; }
  header { color:var(--muted); }
  .account-shell { box-sizing:border-box; width:100%; margin:12px 0; }
  .chat-preview { padding:16px; }
  textarea { box-sizing:border-box; width:100%; }
</style>
