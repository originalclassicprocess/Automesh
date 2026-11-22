<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { untrack } from 'svelte';
  import { modelAvailability, type AgentSettings } from './model';
  import { PORTABLE_MODELS, portableModelId, type PortableProgress } from './portable-models';
  import { portableDownloaded, portableWeightsSaved } from './portable-client';
  import { listFileModels, type FileModel } from './file-models';

  let { settings, busy, working, notice, example, keyPresent, automatic, save, test, stop, forgetKey, revokeAuto, prepare, remove, importModel, deleteModel, progress = null }:
    { settings: AgentSettings; busy: boolean; working: boolean; notice: string; example: string; keyPresent: boolean; automatic: boolean;
      save: (value: AgentSettings, key: string) => Promise<boolean>; test: (value: AgentSettings, key: string, prompt: string) => Promise<boolean>;
      stop: () => void; forgetKey: () => void; revokeAuto: () => void; prepare?: (value: AgentSettings, weights?: File) => Promise<void>;
      remove?: (value: AgentSettings) => Promise<void>; progress?: PortableProgress | null;
      importModel?: (file: File) => Promise<FileModel | undefined>; deleteModel?: (id: string) => Promise<boolean> } = $props();
  let draft = $state<AgentSettings>(untrack(() => ({ ...settings })));
  let key = $state('');
  let availability = $state('');
  let saving = $state(false);
  let checking = $state(false);
  let downloaded = $state(false);
  let weightsSaved = $state(false);
  let deleting = $state(false);
  let weightsInput = $state<HTMLInputElement>();
  let fileInput = $state<HTMLInputElement>();
  let files = $state<FileModel[]>([]);
  let fileBusy = $state(false);
  let testPrompt = $state('');
  const legacy = untrack(() => settings.backend === 'portable' ? settings.model : settings.legacyModel ?? '');
  $effect(() => {
    if (draft.backend !== 'file') return;
    let current = true;
    void listFileModels().then(entries => { if (current) files = entries; }).catch(() => {});
    return () => { current = false; };
  });
  let model = $derived(PORTABLE_MODELS[portableModelId(draft.model)]);
  $effect(() => {
    const id = portableModelId(draft.model); void working; void deleting;
    let current = true; downloaded = false; weightsSaved = false;
    if (draft.backend === 'portable') void Promise.all([portableDownloaded(id), portableWeightsSaved(id)]).then(([ready, saved]) => {
      if (current) { downloaded = ready; weightsSaved = saved; }
    });
    return () => { current = false; };
  });
  let sameEndpoint = $derived(draft.endpoint.trim() === settings.endpoint && draft.backend === settings.backend);
  const providers = [
    { id: 'file' as const, title: 'Файл модели', detail: 'GGUF · llama.cpp' },
    ...(legacy ? [{ id: 'portable' as const, title: 'Ранее установленная модель', detail: 'ONNX · Transformers.js' }] : []),
    { id: 'browser' as const, title: 'Модель браузера', detail: 'Встроенная модель браузера' },
    { id: 'local' as const, title: 'Локальный движок (ПК)', detail: 'Ollama / LM Studio / llama.cpp' },
    { id: 'cloud' as const, title: 'Удалённый API', detail: 'Облако или свой сервер' },
  ];
  const browserStatus: Record<string, string> = { available: 'Модель готова', downloadable: 'Требуется загрузка модели', downloading: 'Модель загружается', unavailable: 'Модель недоступна на этом устройстве' };
  function selectProvider(provider: AgentSettings['backend']) {
    if (draft.backend === provider) return;
    key = ''; availability = '';
    draft = { ...draft, backend: provider, endpoint: provider === settings.backend ? settings.endpoint : '', model: provider === 'portable' ? legacy : provider === settings.backend ? settings.model : '', portableDevice: provider === settings.backend ? settings.portableDevice : 'wasm', ...(legacy ? { legacyModel: legacy } : {}) };
  }
  async function submit() {
    saving = true;
    try { if (await save({ ...draft }, key)) key = ''; }
    finally { saving = false; }
  }
  async function checkBrowser() {
    checking = true;
    try { availability = await modelAvailability(); }
    finally { checking = false; }
  }
</script>

<div class="agent-settings">
  <div class="settings-body">
    <label class="toggle"><span><strong>{$i18n.text('Включить ИИ')}</strong><small>{$i18n.text('Настройки действуют только для этого аккаунта.')}</small></span><input type="checkbox" bind:checked={draft.enabled} disabled={saving || working} /></label>
    <p>{$i18n.text('Кнопка AI в личном чате позволяет выбрать, кому будет отвечать модель.')}</p>
    {#if automatic}<div class="auto-active"><button type="button" onclick={revokeAuto}>{$i18n.text('Отключить автоответы во всех чатах')}</button></div>{/if}
    <fieldset disabled={saving || working || deleting || fileBusy}>
      <legend>{$i18n.text('Источник модели')}</legend>
      <div class="providers">
        {#each providers as provider}
          <button type="button" aria-pressed={draft.backend === provider.id} class:selected={draft.backend === provider.id} onclick={() => selectProvider(provider.id)}><strong>{$i18n.text(provider.title)}</strong><small>{$i18n.text(provider.detail)}</small></button>
        {/each}
      </div>
      {#if draft.backend === 'file'}
        <p>{$i18n.text('Выберите один файл GGUF с чат-шаблоном. Модель хранится в этом браузере и работает на устройстве. Совместимость зависит от модели, браузера и свободной памяти.')}</p>
        <div class="row">
          <button type="button" onclick={() => fileInput?.click()} disabled={!importModel}>{$i18n.text('Выбрать файл GGUF')}</button>
          <input type="file" accept=".gguf" hidden bind:this={fileInput} onchange={async event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (!file || !importModel) return;
            fileBusy = true;
            try {
              const entry = await importModel(file);
              if (entry) { files = [...files, entry]; draft.model = entry.id; }
            } finally { fileBusy = false; }
          }} />
          {#if fileBusy}<span role="status">{$i18n.text('Сохраняем файл модели…')}</span>{/if}
        </div>
        <label>{$i18n.text('Выбранная модель')}<select bind:value={draft.model}>
          <option value="">{$i18n.text('Выберите модель')}</option>
          {#each files as entry (entry.id)}<option value={entry.id}>{entry.name} · {Math.round(entry.bytes / 1024 ** 2)} MiB</option>{/each}
        </select></label>
        {#if draft.model && files.some(entry => entry.id === draft.model)}
          <button type="button" onclick={async () => {
            if (!deleteModel || !confirm($i18n.text('Удалить этот файл из хранилища браузера?'))) return;
            const id = draft.model;
            fileBusy = true;
            try { if (await deleteModel(id)) { files = files.filter(entry => entry.id !== id); draft.model = ''; } }
            finally { fileBusy = false; }
          }}>{$i18n.text('Удалить модель')}</button>
        {/if}
        <label>{$i18n.text('Движок выполнения')}<select bind:value={draft.portableDevice}>
          <option value="wasm">WASM — {$i18n.text('Совместимый режим')}</option>
          <option value="webgpu">WebGPU — {$i18n.text('Аппаратное ускорение')}</option>
        </select></label>
      {:else if draft.backend === 'portable'}
        <p>{$i18n.text('Модель работает на устройстве. Переписка не отправляется внешнему поставщику.')}</p>
        <strong>{model.title}</strong>
        <p><a href={'https://huggingface.co/' + model.repo + '/tree/' + model.revision} target="_blank" rel="noreferrer">Hugging Face · {model.title}</a></p>
        <label>{$i18n.text('Движок выполнения')}<select value={draft.portableDevice ?? 'wasm'} onchange={e => draft.portableDevice = e.currentTarget.value === 'webgpu' ? 'webgpu' : 'wasm'}>
          <option value="wasm">WASM — {$i18n.text('Совместимый режим')}</option>
          <option value="webgpu">WebGPU — {$i18n.text('Аппаратное ускорение')}</option>
        </select></label>
        <p>{$i18n.text('Веса скачиваются с Hugging Face или копируются из выбранного файла в хранилище браузера. При первом импорте может потребоваться скачать конфигурацию и токенизатор.')}</p>
        <div class="row"><span class="model-state" role="status">{$i18n.text(downloaded ? 'Файлы модели сохранены' : weightsSaved ? 'Веса сохранены' : 'Требуется загрузка модели')}</span>
          <button type="button" disabled={busy || !prepare} onclick={() => void prepare?.({ ...draft })}>{$i18n.text(downloaded ? 'Проверить и восстановить модель' : weightsSaved ? 'Подготовить модель' : 'Скачать с Hugging Face')}</button>
          <button type="button" disabled={busy || !prepare} onclick={() => weightsInput?.click()}>{$i18n.text('Выбрать файл весов')}</button>
          <input type="file" accept=".onnx" hidden bind:this={weightsInput} onchange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void prepare?.({ ...draft }, file);
          }} />
          <button type="button" disabled={busy || deleting || !remove} onclick={async () => { deleting = true; try { await remove?.({ ...draft }); } finally { deleting = false; } }}>{$i18n.text('Удалить модель')}</button>
        </div>
      {:else if draft.backend === 'browser'}
        <p>{$i18n.text('Использует встроенную модель браузера, если она доступна. Поддержка зависит от устройства и браузера.')}</p>
        <div class="row"><button type="button" onclick={checkBrowser} disabled={checking}>{$i18n.text('Проверить модель браузера')}</button>{#if availability}<span class="model-state" role="status">{$i18n.text(browserStatus[availability] ?? browserStatus.unavailable)}</span>{/if}</div>
      {:else}
        <label>OpenAI-compatible API URL<input type="url" bind:value={draft.endpoint} oninput={() => { key = ''; }} maxlength="2048" placeholder={draft.backend === 'local' ? 'http://localhost:11434/v1/chat/completions' : 'https://api.example.com/v1/chat/completions'} /></label>
        <label>{$i18n.text('Имя модели')}<input bind:value={draft.model} maxlength="256" placeholder="model-id" /></label>
        <label>API key<input type="password" bind:value={key} maxlength="8192" autocomplete="off" placeholder={keyPresent && sameEndpoint ? '••••••••' : ''} /></label>
        {#if keyPresent && sameEndpoint}<div class="row"><small>{$i18n.text('Ключ сохранён в текущем сеансе.')}</small><button type="button" onclick={() => { key = ''; forgetKey(); }}>{$i18n.text('Удалить ключ')}</button></div>{/if}
        <p class="privacy">{$i18n.text('Ключ действует только до блокировки или смены аккаунта. Текст передаётся указанному движку; для облачного API он покидает устройство.')}</p>
      {/if}
      <label>{$i18n.text('Инструкции для модели')}<textarea rows="3" bind:value={draft.instructions} maxlength="1024" placeholder={$i18n.text('Необязательно')} ></textarea></label>
      <label>{$i18n.text('Тестовый запрос')}<input bind:value={testPrompt} maxlength="1000" placeholder={$i18n.text('Введите запрос для проверки модели')} /></label>
    </fieldset>
    <div class="row actions">
      <button type="button" onclick={() => void test({ ...draft }, key, testPrompt.trim() || $i18n.text('Расскажи, что такое Луна, в одном предложении.'))} disabled={busy || working || saving || deleting || fileBusy || draft.backend === 'portable' && !downloaded || draft.backend === 'file' && !draft.model}>{$i18n.text('Проверить подключение')}</button>
      <button class="primary" type="button" onclick={submit} disabled={saving || busy || working || deleting || fileBusy}>{$i18n.text('Сохранить настройки ИИ')}</button>
      {#if working}<button type="button" onclick={stop}>{$i18n.text('Отменить запрос ИИ')}</button>{/if}
    </div>
    <p>{$i18n.text('При проверке отправляется только тестовый запрос, без переписки.')}</p>
    {#if progress && working}<div class="result" role="status"><span>{$i18n.text(progress.importing ? 'Проверка и копирование файла' : 'Загрузка модели')} · {Math.round(progress.loaded / 1000000)} / {Math.round(progress.total / 1000000)} MB</span><progress value={progress.loaded} max={Math.max(progress.total, progress.loaded, 1)}></progress></div>
    {:else if notice || working}<div class="result" role="status">{working ? $i18n.text('Модель выполняет запрос…') : $i18n.text(notice)}</div>{/if}
    {#if example && !working}<div class="result example"><small>{$i18n.text('Ответ модели')}</small><p>{example}</p></div>{/if}
  </div>
</div>

<style>
  .settings-body { display:grid; gap:12px; }
  fieldset { min-width:0; border:0; margin:0; padding:0; }
  legend { font-weight:600; margin-bottom:8px; }
  .providers { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,130px),1fr)); gap:8px; }
  .providers button { text-align:left; display:flex; flex-direction:column; gap:5px; padding:11px; min-width:0; }
  .providers button.selected { border-color:var(--accent); box-shadow:inset 0 0 0 1px var(--accent); }
  label:not(.toggle) { display:grid; gap:6px; margin:12px 0; }
  .toggle { display:flex; justify-content:space-between; align-items:center; gap:12px; padding:10px 0; }
  .toggle span { display:grid; gap:4px; }
  .toggle input { width:20px; height:20px; flex:none; }
  input:not([type=checkbox]), textarea, select, progress { box-sizing:border-box; width:100%; min-width:0; }
  textarea { resize:vertical; }
  p, small { color:var(--muted); font-size:13px; line-height:1.4; margin:0; }
  .row { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
  .row.actions > button { flex:1 1 auto; }
  .privacy, .auto-active, .result { border:1px solid var(--line); border-radius:10px; padding:10px; }
  .auto-active { display:flex; align-items:center; }
  .example p { margin-top:5px; color:inherit; white-space:pre-wrap; overflow-wrap:anywhere; }
  .model-state { color:var(--muted); font-size:13px; }
</style>
