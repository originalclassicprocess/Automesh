<script lang="ts">
  import { onMount } from 'svelte';
  import CallPanel from '$lib/calls/CallPanel.svelte';
  import CallHistoryCard from '$lib/calls/CallHistoryCard.svelte';
  import { idleCall, type CallView, type CallPhase } from '$lib/calls/controller';
  import { checkBrowserCalls } from '$lib/calls/browser-check';
  import '$lib/application/application-ui.css';
  let view = $state<CallView>(idleCall()), result = $state(''), running = $state(false);
  function preview(phase: CallPhase) {
    view = { ...idleCall(), phase, id: crypto.randomUUID(), peer: 'mesh1qxnhrv2f9p8ev4jyyqq9jsjw7pfwsurctgzfczmf', outgoing: phase !== 'incoming',
      created: Date.now() - (phase === 'active' ? 62000 : 0), authenticated: phase === 'active', code: phase === 'active' ? 'A1B2 C3D4 E5F6 0123 4567 89AB CDEF 4567' : '', started: phase === 'active' ? Date.now() - 62000 : 0 };
  }
  async function run() {
    if (running) return; running = true; result = '';
    try { result = JSON.stringify(await checkBrowserCalls()); }
    catch (error) { result = 'FAILED: ' + (error instanceof Error ? error.message : 'unknown'); }
    finally { running = false; }
  }
  onMount(() => { if (new URL(location.href).searchParams.get('run') === '1') void run(); });
</script>
<main><h2>Звонки · изолированная проверка</h2><p>Без аккаунтов пользователя, нод и доступа к микрофону. Тест использует синтетический тон.</p>
  <nav aria-label="Примеры интерфейса"><button onclick={() => preview('incoming')}>Входящий</button><button onclick={() => preview('outgoing')}>Исходящий</button><button onclick={() => preview('active')}>Разговор</button></nav>
  <button onclick={() => void run()} disabled={running}>Проверить реальные WebRTC-соединения</button>
  <output data-testid="call-browser-result">{running ? 'Проверяем…' : result}</output>
  {#if view.id}<CallHistoryCard record={view} onCall={() => preview('outgoing')} onDelete={() => view = idleCall()} />{/if}
  <CallPanel {view} name="Анна · пример" stream={null} onAccept={() => preview('active')} onEnd={() => view = { ...view, phase: 'ended', reason: 'finished', ended: Date.now(), authenticated: false }}
    onMute={() => view = { ...view, muted: !view.muted }} onDismiss={() => view = idleCall()} onChat={() => view = idleCall()} />
</main>
<style>main { max-width:720px; margin:24px auto; padding:16px; } nav { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; } output { display:block; overflow-wrap:anywhere; padding:12px; margin-bottom:16px; }</style>
