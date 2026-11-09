<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onDestroy } from 'svelte';
  import { fetchNodeDownload, nodeDownloads, type NodeDownload, type NodePlatform } from './node-downloads';
  import { packageVerificationCommand } from '../application/package-provenance.js';
  let values = $state<Partial<Record<NodePlatform, NodeDownload>>>({});
  let checked = $state(false); let busy = $state(false); let note = $state('');
  let alive = true; let controller: AbortController | null = null;
  const platforms: NodePlatform[] = ['windows', 'linux'];
  onDestroy(() => { alive = false; controller?.abort(); });
  async function refresh() {
    if (busy) return;
    busy = true; note = ''; controller = new AbortController();
    const current = controller; const timer = setTimeout(() => current.abort(), 8000);
    try {
      const results = await Promise.all(platforms.map(async platform => {
        try { return [platform, await fetchNodeDownload(platform, current.signal)] as const; }
        catch { return [platform, undefined] as const; }
      }));
      if (alive) { values = Object.fromEntries(results); checked = true; }
    } finally { clearTimeout(timer); if (alive) busy = false; }
  }
  async function copy(value: string, message = 'Контрольная сумма скопирована.') {
    try { await navigator.clipboard.writeText(value); if (alive) note = message; }
    catch { if (alive) note = 'Не удалось скопировать. Выделите текст вручную.'; }
  }
</script>
<section class="downloads" aria-label={$i18n.text("Скачать свою ноду")}>
  <h4>{$i18n.text("Скачать свою ноду")}</h4>
  <p>{$i18n.text("Windows — домашний компьютер с окном управления. Linux — отдельный процесс с веб-панелью; потребуется настроить HTTPS и доступ к компьютеру.")}</p>
  <button disabled={busy} onclick={refresh}>{busy ? $i18n.text("Проверяем сборки…") : checked ? $i18n.text("Обновить доступные сборки") : $i18n.text("Проверить загрузки Windows и Linux")}</button>
  <div class="platforms">
    {#each platforms as platform}
      {@const build = values[platform]}
      <article>
        <strong>{$i18n.text(nodeDownloads[platform].label)}</strong>
        {#if build}
          <small>{$i18n("m_8966a6a1eb77", {v0: (build.version), v1: (Math.ceil(build.bytes / 1024 / 1024))})}</small>
          <a href={build.url} download>{$i18n("m_fc05f459f832", {v0: (platform === 'windows' ? 'Windows' : 'Linux')})}</a>
          {#if !build.signed}<small>{$i18n.text("Без цифровой подписи издателя. Не отключайте защиту системы.")}</small>{/if}
          {#if build.provenance}
            <small>{$i18n.text("Есть ссылка на сборку GitHub. Скачанный файл ещё нужно проверить.")}</small>
          {:else}<small>{$i18n.text("Происхождение GitHub не подтверждено: локальная сборка.")}</small>{/if}
          <details>
            <summary>{$i18n.text("Проверить происхождение файла")}</summary>
            <small>{$i18n.text("Проверка выполняется до запуска файла через официальный GitHub CLI. Она проверяет подпись, файл, репозиторий и процесс сборки, но не гарантирует отсутствие ошибок в программе.")}</small>
            <a href="https://cli.github.com/" target="_blank" rel="noopener noreferrer">{$i18n.text("Получить GitHub CLI")}</a>
            {#if build.provenance}
              <a href={`https://github.com/${build.provenance.repository}/actions/runs/${build.provenance.runId}`} target="_blank" rel="noopener noreferrer">{$i18n.text("Сборка на GitHub")}</a>
              <small>{$i18n("m_d5cb7123852b", {v0: (build.provenance.commit)})}</small>
              <a href={build.provenance.bundleUrl} download>{$i18n.text("Скачать подтверждение")}</a>
            {/if}
            <small>{$i18n.text("В папке со скачанным файлом выполните команду. При ошибке проверки не устанавливайте пакет. У локальной сборки подтверждения может ещё не быть.")}</small>
            <code>{packageVerificationCommand(platform, build.provenance?.commit)}</code>
            <button onclick={() => copy(packageVerificationCommand(platform, build.provenance?.commit), 'Команда проверки скопирована.')}>{$i18n.text("Скопировать команду проверки")}</button>
            <small>{$i18n.text("SHA-256 подтверждает совпадение файла, но не защищает от взлома сайта загрузки.")}</small>
            <code>{build.sha256}</code><button onclick={() => copy(build.sha256)}>{$i18n.text("Скопировать SHA-256")}</button>
          </details>
        {:else}<small>{checked ? $i18n.text("Сборка пока недоступна или не прошла проверку описания.") : $i18n.text("Доступность проверяется перед загрузкой.")}</small>{/if}
      </article>
    {/each}
  </div>
  {#if note}<p role="status">{$i18n.text(note)}</p>{/if}
</section>
<style>
  .downloads { border:1px solid var(--line); border-radius:16px; padding:14px; margin:12px 0; }
  h4 { margin:0; } p { font-size:14px; line-height:1.5; }
  .platforms { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr)); gap:12px; margin-top:12px; }
  article { padding:12px; border:1px solid var(--line); border-radius:14px; min-width:0; }
  small { display:block; color:var(--muted); font-size:12px; line-height:1.5; margin:8px 0; }
  a,button { display:inline-flex; justify-content:center; align-items:center; min-height:44px; padding:8px 12px; border:1px solid var(--line); border-radius:12px; background:var(--accent-soft); color:inherit; text-decoration:none; }
  code { display:block; font-size:12px; overflow-wrap:anywhere; margin:8px 0; user-select:all; }
  summary { cursor:pointer; font-size:13px; margin-top:10px; }
</style>
