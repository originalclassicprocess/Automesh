<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import type { ChatService } from '../chat/ChatService';
  import type { BackupProfile } from '../backup/full-backup';
  import { createHistoryReceiver, idleHistoryStatus } from './history-transfer';
  import { formatBytes } from '../application/storage-summary';
  let { chat, owner, device, allowed, commit, guard }: { chat: ChatService; owner: string; device: string; allowed(): boolean;
    commit(profile: BackupProfile): Promise<void>; guard(): void } = $props();
  let state = $state(idleHistoryStatus()), receiver: ReturnType<typeof createHistoryReceiver> | undefined;
  let alive = true;
  onMount(() => {
    receiver = createHistoryReceiver({ owner, device, allowed, commit, guard: () => { if (!alive) throw new Error('history_closed'); if (document.hidden) throw new Error('history_paused'); guard(); },
      update: value => { if (alive) state = value; },
      cancel: (peer, value) => chat.sendDeviceControl('history', value, peer),
      send: async (peer, value) => { guard(); await chat.connectAndWait(peer); guard(); await chat.sendDeviceControl('history', value, peer); } });
    const off = chat.onDeviceControl((peer, kind, value) => { if (kind === 'history') void receiver?.receive(peer, value); });
    const timer = setInterval(() => { if (!document.hidden) void receiver?.tick(); }, 2000);
    return () => { alive = false; clearInterval(timer); off(); receiver?.close(); };
  });
</script>
{#if state.phase !== 'idle'}<section class="history-receive" class:compact={state.phase === 'done'} aria-label={$i18n.text("Получение старой истории")}>
  {#if state.phase === 'done'}<small role="status">{$i18n.text("✓ Перенесённая история сохранена на устройстве.")}</small>
  {:else}
  <strong>{$i18n.text("История с устройства владельца")}</strong>
  {#if state.summary}<p>{$i18n("m_ad44c1ab0f2c", {v0: (state.summary.contacts), v1: (state.summary.messages), v2: (state.summary.files), v3: (state.summary.missingFiles)})}</p>{/if}
  {#if state.phase === 'offered'}<p>{$i18n.text("Принять выбранную владельцем историю и вложения? Рабочие сообщения, настройки, ключи и права этого устройства не заменяются.")}</p>
    <button type="button" onclick={() => void receiver?.accept()}>{$i18n.text("Принять историю")}</button>
  {:else if ['receiving','verifying','saving','paused'].includes(state.phase)}
    <progress max={state.total} value={state.received} aria-label={$i18n.text("Получение истории")}></progress><small>{$i18n.system(formatBytes(state.received))} / {$i18n.system(formatBytes(state.total))}</small>
    <p role="status">{state.phase === 'verifying' ? $i18n.text("Проверяем целостность и принадлежность истории…") : state.phase === 'saving' ? $i18n.text("Сохраняем проверенную историю и вложения…") : state.phase === 'paused' ? $i18n.text("Ожидаем прямую связь. Продолжим автоматически, пока устройства открыты.") : $i18n.text("Получаем историю. Новые сообщения продолжают работать.")}</p>
  {:else if state.error}<p role="alert">{$i18n.text(state.error)}</p>{/if}
  {/if}
  <button type="button" disabled={state.phase === 'saving'} onclick={() => void receiver?.cancel()}>{state.phase === 'done' || state.phase === 'error' ? $i18n.text("Скрыть перенос") : $i18n.text("Отклонить / остановить перенос")}</button>
</section>{/if}
<style>
  .history-receive{border:1px solid var(--line);border-radius:12px;background:var(--surface);padding:12px;margin:8px 0;overflow-wrap:anywhere}p{margin:8px 0}button{min-height:44px;margin:6px 8px 0 0}progress{width:100%;accent-color:var(--accent)}small{color:var(--muted)}
  .compact{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;margin:4px 0}.compact small{color:var(--success)}.compact button{margin:0;min-height:32px;font-size:12px;flex-shrink:0}
</style>
