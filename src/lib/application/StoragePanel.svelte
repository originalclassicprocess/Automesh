<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { categoryNames, formatBytes, type ManagedFile } from './storage-summary';
  import HelpInfo from './HelpInfo.svelte';
  import ChoiceMenu from './ChoiceMenu.svelte';
  let { files, historyBytes, otherBytes, cacheBytes, originUsage, quota, volatile, busy, error,
    refresh, clean, download }: {
    files: ManagedFile[]; historyBytes: number; otherBytes: number; cacheBytes: number;
    originUsage?: number; quota?: number; volatile: boolean; busy: boolean; error: string;
    refresh: () => void; clean: (kind: string, ids: string[]) => void; download: (peer: string, id: string) => void;
  } = $props();
  let filter = $state('all');
  let shown = $derived(files.filter(file => filter === 'all' || file.category === filter));
  let total = $derived(historyBytes + files.reduce((sum, file) => sum + file.bytes, 0));
</script>
<section aria-label={$i18n.text("Менеджер памяти")}>
  <h4>{$i18n.text("Хранилище")} <HelpInfo label={$i18n.text("Справка: хранилище приложения")} text={$i18n.text("Показаны локальная переписка, вложения и кэш этого адреса в текущем профиле браузера. Это не память всего устройства. Секретные ключи и seed здесь не отображаются; очистка не удаляет копии у собеседников. Удаление требует подтверждения.")} /></h4>
  <div class="dashboard">
    <div><small>{$i18n.text("Переписка и вложения на диске")}</small><strong>{$i18n.system(formatBytes(total))}</strong></div>
    <div><small>{$i18n.text("Вложения в памяти вкладки")}</small><strong>{$i18n.system(formatBytes(files.reduce((sum, file) => sum + file.memoryBytes, 0)))}</strong></div>
    <div><small>{$i18n.text("Кэш приложения")}</small><strong>{$i18n.system(formatBytes(cacheBytes))}</strong></div>
  </div>
  {#if originUsage !== undefined}<p><small>{$i18n("m_b2ca9ed0e411", {v0: ($i18n.system(formatBytes(originUsage))), v1: (quota ? $i18n("m_1ab9ceafdb2f", {v0: ($i18n.system(formatBytes(quota)))}) : '')})}</small></p>{/if}
  {#if otherBytes > 0}<p><small>{$i18n("m_4e21c4740802", {v0: ($i18n.system(formatBytes(otherBytes)))})}</small></p>{/if}
  {#if volatile}<p><small>{$i18n.text("Недоверенный режим: новая переписка находится в памяти вкладки. Здесь также видны оставшиеся данные прошлых доверенных сеансов.")}</small></p>{/if}
  <button onclick={refresh} disabled={busy}>{busy ? $i18n.text("Подождите…") : $i18n.text("Обновить размеры")}</button>
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
  <h4>{$i18n.text("Очистка")}</h4>
  <p><small>{$i18n("m_aa56d0796fdf", {v0: ($i18n.system(formatBytes(historyBytes)))})}</small></p>
  <button onclick={() => clean('history', [])} disabled={busy}>{$i18n.text("Удалить переписку и вложения")}</button>
  <div class="categories">
    {#each Object.entries(categoryNames) as [kind, label]}
      {@const group = files.filter(file => file.category === kind)}
      <div><strong>{$i18n.text(label)}</strong> · {group.length} · {$i18n.system(formatBytes(group.reduce((sum, file) => sum + file.bytes + file.memoryBytes, 0)))}
        <button onclick={() => clean(label, group.map(file => file.id))} disabled={busy || !group.length}>{$i18n.text("Очистить")}</button>
      </div>
    {/each}
  </div>
  <h4>{$i18n.text("Сохранённые файлы")}</h4>
  <ChoiceMenu value={filter} label={$i18n.text("Показать файлы")} options={[{value:'all',label:$i18n.text("Все файлы")},...Object.entries(categoryNames).map(([value,label])=>({value,label}))]} onChange={value=>filter=value} />
  <div class="file-list">
    {#each shown as file (file.id)}
      <div class="file-row"><span>{file.name}<br /><small>{$i18n.system(formatBytes(file.bytes + file.memoryBytes))}</small></span>
        {#if file.peer}<button onclick={() => download(file.peer, file.messageId)} disabled={busy}>{$i18n.text("Скачать")}</button>{/if}
        <button onclick={() => clean(file.name, [file.id])} disabled={busy}>{$i18n.text("Удалить")}</button>
      </div>
    {:else}<p>{$i18n.text("Сохранённых файлов в этой категории нет.")}</p>{/each}
  </div>
  <p><small>{$i18n.text("Удаление действует только на этом адресе сайта в этом профиле браузера. Скачанные копии и данные собеседников остаются.")}</small></p>
</section>
<style>
  .dashboard { display:flex; flex-wrap:wrap; gap:10px; }
  .dashboard > div { padding:12px; border:1px solid var(--line); border-radius:8px; min-width:140px; }
  strong { display:inline-block; } .dashboard strong { display:block; margin-top:6px; font-size:1.3em; }
  .categories { display:grid; gap:8px; margin-top:12px; }
  .file-list { max-height:380px; overflow:auto; margin-top:12px; }
  .file-row { display:flex; gap:8px; align-items:center; padding:8px; border-bottom:1px solid var(--line); }
  .file-row span { flex:1; min-width:0; overflow-wrap:anywhere; }
</style>
