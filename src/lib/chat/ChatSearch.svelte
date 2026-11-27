<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import type { ChatEntry } from './session-chats';
  import { searchMessages,type SearchKind } from './chat-search';
  let { messages, onJump, onClose, focus = false }: { messages: ChatEntry[]; onJump(id: string): void; onClose(): void; focus?: boolean } = $props();
  let query = $state(''), date = $state(''), index = $state(-1),kind=$state<SearchKind>('all');
  const matches = $derived(searchMessages(messages, query, date,kind));
  function move(offset: number) {
    if (!matches.length) return;
    index = index<0?(offset<0?matches.length-1:0):(Math.min(index,matches.length-1)+offset+matches.length)%matches.length;
    onJump(matches[index].id);
  }
  function manageKeys(form: HTMLFormElement) {
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    form.addEventListener('keydown', dismiss);
    if (focus) form.querySelector<HTMLInputElement>('input[type=search]')?.focus({ preventScroll:true });
    return { destroy() { form.removeEventListener('keydown', dismiss); } };
  }
</script>
<form class="chat-search" use:manageKeys aria-label={$i18n.text("Поиск в переписке")} onsubmit={event => { event.preventDefault(); move(1); }}>
  <input type="search" aria-label={$i18n.text("Текст сообщения")} placeholder={$i18n.text("Найти в чате…")} bind:value={query} oninput={() => index = -1} />
  <input type="date" aria-label={$i18n.text("Дата сообщения")} bind:value={date} onchange={() => index = -1} />
  <select aria-label={$i18n.text('Тип содержимого')} bind:value={kind} onchange={()=>index=-1}>
    <option value="all">{$i18n.text('Всё')}</option><option value="images">{$i18n.text('Фото')}</option><option value="videos">{$i18n.text('Видео')}</option><option value="audio">{$i18n.text('Аудио')}</option><option value="files">{$i18n.text('Файлы')}</option><option value="links">{$i18n.text('Ссылки')}</option>
  </select>
  <div class="results">
    <small role="status">{matches.length ? `${Math.min(Math.max(0,index) + 1, matches.length)} / ${matches.length}` : query || date || kind!=='all' ? $i18n.text("Не найдено") : $i18n.text("Текст или дата")}</small>
    <button type="button" onclick={() => move(-1)} disabled={!matches.length} aria-label={$i18n.text("Предыдущее совпадение")}>↑</button>
    <button type="submit" disabled={!matches.length} aria-label={$i18n.text("Перейти к совпадению")}>↓</button>
    <button type="button" onclick={onClose} aria-label={$i18n.text("Закрыть поиск")}>✕</button>
  </div>
</form>
<style>
  .chat-search { display:flex; flex-wrap:wrap; gap:6px; padding:8px 0; align-items:center; }
  input { min-width:0; flex:1 1 140px; width:140px; font-size:14px; }
  select { min-width:0;flex:0 1 130px;font-size:13px; }
  .results { display:flex; gap:4px; align-items:center; margin-left:auto; }
  small { color:var(--muted); font-size:12px; } button { padding:6px 10px; min-height:36px; }
</style>
