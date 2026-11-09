<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import type { ChatService } from '../chat/ChatService';
  import type { BackupProfile } from '../backup/full-backup';
  import { createHistorySender, historyError, idleHistoryStatus } from './history-transfer';
  import { formatBytes } from '../application/storage-summary';
  let { chat, owner, device, label, conversations, authorize, capture, onClose }: { chat: ChatService; owner: string; device: string; label: string;
    conversations: Array<{ peer: string; name: string; count: number }>; authorize(): Promise<void>;
    capture(peers: string[], attachments: boolean, guard: () => void): Promise<BackupProfile>; onClose(): void } = $props();
  let chosen = $state<string[]>([]);
  let attachments = $state(true);
  let progress = $state(idleHistoryStatus());
  let alive = true;
  let sender: ReturnType<typeof createHistorySender> | undefined;
  const active = $derived(!['idle', 'done', 'error'].includes(progress.phase));
  function guard() { if (!alive) throw new Error('history_closed'); if (document.hidden) throw new Error('history_paused'); }
  async function start() {
    if (!chosen.length || active || !sender) return;
    progress = { phase: 'preparing', received: 0, total: 0 };
    let profile: BackupProfile | undefined;
    try { await authorize(); guard(); profile = await capture([...chosen], attachments, guard); guard(); await sender.start(profile); }
    catch (error) { if (alive) progress = { phase: 'error', received: 0, total: 0, error: historyError(error) }; }
    finally { if (profile) for (const bytes of profile.files.values()) bytes.fill(0); }
  }
  onMount(() => {
    sender = createHistorySender({ owner, device, authorize, guard, update: value => { if (alive) progress = value; },
      cancel: (peer, value) => chat.sendDeviceControl('history', value, peer),
      send: async (peer, value) => { guard(); await chat.connectAndWait(peer); guard(); await chat.sendDeviceControl('history', value, peer); } });
    const off = chat.onDeviceControl((peer, kind, value) => { if (kind === 'history') void sender?.receive(peer, value); });
    const timer = setInterval(() => { if (!document.hidden) void sender?.tick(); }, 2000);
    return () => { alive = false; clearInterval(timer); off(); sender?.close(); };
  });
</script>
<section aria-label={$i18n.text("Перенос истории на устройство")}>
  <h4>{$i18n("m_83c9aab9ad1f", {v0: (label)})}</h4>
  <p>{$i18n.text("Выберите чаты для переноса. Держите оба приложения открытыми: история передаётся по зашифрованному прямому соединению, без очереди ноды.")}</p>
  <p class="help-text">{$i18n.text("Сид и ключи доступа не передаются. До 128 МиБ за перенос; существующая переписка не перезаписывается, исчезающие сообщения исключены.")}</p>
  <p class="help-text">{$i18n.text("После перезагрузки начните перенос заново — копии сообщений не появятся. Если приглашение не видно, обновите оба приложения и повторите.")}</p>
  {#if !active && progress.phase !== 'done'}
    <button type="button" onclick={() => chosen = chosen.length === conversations.length ? [] : conversations.map(c => c.peer)}>{$i18n.text("Выбрать все чаты / снять выбор")}</button>
    <div class="choices">{#each conversations as conversation (conversation.peer)}
      <label><input type="checkbox" bind:group={chosen} value={conversation.peer} /> <span>{conversation.name} <small>{$i18n("m_a5aa375e42d5", {v0: (conversation.count)})}</small></span></label>
    {/each}</div>
    <label><input type="checkbox" bind:checked={attachments} /> {$i18n.text("Включить доступные вложения")}</label>
    <button type="button" disabled={!chosen.length} onclick={() => void start()}>{$i18n.text("Подготовить и предложить перенос")}</button>
  {/if}
  {#if progress.phase === 'preparing'}<p role="status">{$i18n.text("Подготавливаем копию и проверяем вложения… Новые сообщения продолжают работать.")}</p>{/if}
  {#if progress.summary}<p>{$i18n("m_ad44c1ab0f2c", {v0: (progress.summary.contacts), v1: (progress.summary.messages), v2: (progress.summary.files), v3: (progress.summary.missingFiles)})}</p>{/if}
  {#if progress.total > 0 && active}<progress max={progress.total} value={progress.received} aria-label={$i18n.text("Прогресс переноса истории")}></progress><small>{$i18n.system(formatBytes(progress.received))} / {$i18n.system(formatBytes(progress.total))}</small>{/if}
  {#if progress.phase === 'offered'}<p role="status">{$i18n.text("На втором устройстве нажмите «Принять историю». До согласия данные истории не передаются.")}</p>
  {:else if progress.phase === 'sending'}<p role="status">{$i18n.text("Передаём историю. Не закрывайте это окно.")}</p>
  {:else if progress.phase === 'paused'}<p role="status">{$i18n.text("Ожидаем прямую связь. Перенос продолжится автоматически в этом сеансе.")}</p>
  {:else if progress.phase === 'done'}<p role="status">{$i18n.text("История сохранена на устройстве. Перенос завершён.")}</p>
  {:else if progress.error}<p role="alert">{$i18n.text(progress.error)}</p>{/if}
  <button type="button" onclick={onClose}>{active ? $i18n.text("Остановить и закрыть перенос") : $i18n.text("Закрыть перенос")}</button>
</section>
<style>
  p{overflow-wrap:anywhere}.choices{max-height:32vh;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:8px;margin:12px 0}label{display:flex;align-items:center;gap:10px;padding:8px}input[type=checkbox]{width:22px;height:22px;flex-shrink:0}small{display:block;color:var(--muted)}progress{width:100%;accent-color:var(--accent)}button{min-height:44px;margin:6px 8px 6px 0}
</style>
