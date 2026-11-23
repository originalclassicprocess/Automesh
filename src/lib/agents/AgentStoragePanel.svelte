<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { formatBytes } from '$lib/application/storage-summary';
  import { fileModelRuntime } from './file-model-client';
  import { portableModelRuntime } from './portable-client';
  import { listCachedOnnxModels, listStoredGgufModels, type StoredAgentModel } from './model-storage';
  import { PORTABLE_MODELS, portableModelId } from './portable-models';

  let { revision, busy, working, onRemove, onUnload }:
    { revision: number; busy: boolean; working: boolean;
      onRemove: (model: StoredAgentModel) => Promise<boolean>; onUnload: () => void } = $props();
  let models = $state.raw<StoredAgentModel[]>([]);
  let reading = $state(true), deleting = $state(false), inventoryError = $state(false), deleteError = $state(false);
  const active = $derived($fileModelRuntime ?? $portableModelRuntime);
  const activeName = $derived($fileModelRuntime
    ? models.find(model => model.kind === 'gguf' && model.id === $fileModelRuntime?.id)?.name || $i18n.text('Модель из файла GGUF')
    : $portableModelRuntime ? PORTABLE_MODELS[portableModelId($portableModelRuntime.id)].title : '');

  $effect(() => {
    void revision;
    let current = true;
    reading = true;
    void Promise.allSettled([listStoredGgufModels(), listCachedOnnxModels()]).then(results => {
      if (!current) return;
      models = results.flatMap<StoredAgentModel>(result => result.status === 'fulfilled' ? result.value : []);
      inventoryError = results.some(result => result.status === 'rejected');
      reading = false;
    });
    return () => { current = false; };
  });

  async function remove(model: StoredAgentModel) {
    if (busy || working || deleting || !confirm($i18n.text('Удалить эту модель из хранилища браузера? Файлы моделей общие для профилей Automesh в этом браузере.'))) return;
    deleting = true; deleteError = false;
    try { deleteError = !await onRemove(model); }
    finally { deleting = false; }
  }
</script>

<details class="model-storage" open>
  <summary>{$i18n.text('Модели ИИ')}</summary>
  {#if active}
    <div class="runtime">
      <span><strong>{activeName}</strong><small>{$i18n.text(active.phase === 'loaded' ? 'В памяти этой вкладки' : 'Запуск модели…')} · {active.device === 'webgpu' ? 'WebGPU' : 'WASM'}</small></span>
      <button type="button" onclick={onUnload} disabled={busy || deleting}>{$i18n.text('Выгрузить из памяти')}</button>
    </div>
  {:else if models.length}
    <p role="status">{$i18n.text('В этой вкладке модель не загружена.')}</p>
  {/if}
  {#if inventoryError}<p role="alert">{$i18n.text('Не удалось прочитать часть хранилища моделей.')}</p>{/if}
  {#if deleteError}<p role="alert">{$i18n.text('Не удалось удалить модель.')}</p>{/if}
  {#if reading && !models.length}<p role="status">{$i18n.text('Подождите…')}</p>
  {:else}
    <ul>
      {#each models as model (`${model.kind}:${model.id}`)}
        <li>
          <span><strong>{model.name}</strong><small>
            {model.kind === 'gguf' ? 'GGUF' : 'ONNX'} ·
            {model.bytes === null ? $i18n.text('Размер кэша недоступен') : $i18n.system(formatBytes(model.bytes))}
          </small></span>
          <button type="button" onclick={() => void remove(model)} disabled={busy || working || deleting || reading}
            aria-label={`${$i18n.text('Удалить модель')} · ${model.name}`} title={model.name}>{$i18n.text('Удалить из хранилища')}</button>
        </li>
      {:else}
        {#if !inventoryError}<li class="empty">{$i18n.text('В браузере пока нет сохранённых моделей.')}</li>{/if}
      {/each}
    </ul>
  {/if}
</details>

<style>
  .model-storage { margin:16px 0; border:1px solid var(--line); border-radius:12px; padding:12px; }
  summary { font-weight:600; cursor:pointer; }
  ul { display:grid; margin:6px 0 0; padding:0; list-style:none; }
  li, .runtime { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:8px 0; }
  li + li { border-top:1px solid var(--line); }
  .runtime { border-bottom:1px solid var(--line); }
  li span, .runtime span { display:grid; flex:1 1 160px; min-width:0; overflow-wrap:anywhere; }
  small, p, .empty { color:var(--muted); font-size:13px; }
  button { min-height:34px; font-size:13px; }
  @media(pointer:coarse) { button { min-height:44px; } }
</style>
