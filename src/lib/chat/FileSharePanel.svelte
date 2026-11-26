<script lang="ts">
  import { onMount } from 'svelte';
  import { tr as i18n } from '$lib/i18n/language';

  let { name, load, download, close }: {
    name: string; load(): Promise<File>; download(): void; close(): void;
  } = $props();
  let file = $state<File>(), preparing = $state(true), error = $state('');
  let active = false;
  const canShare = $derived(!!file && typeof navigator !== 'undefined' &&
    !!navigator.share && !!navigator.canShare?.({ files:[file] }));

  onMount(() => {
    active = true;
    void load().then(prepared => { if (active) file = prepared; })
      .catch(reason => { if (active) error = reason instanceof Error ? reason.message : 'Не удалось подготовить файл.'; })
      .finally(() => { if (active) preparing = false; });
    return () => { active = false; };
  });

  async function share() {
    if (!canShare || !file) return;
    error = '';
    try {
      await navigator.share({ files:[file] });
      if (active) close();
    } catch (reason) {
      if (active && !(reason instanceof Error && reason.name === 'AbortError'))
        error = 'Не удалось поделиться. Можно скачать файл или скопировать текст.';
    }
  }
</script>

<p>{$i18n.text('Снаружи Automesh это уже не защищённый чат. Получатели и выбранное приложение смогут сохранить копию.')}</p>
<p>{name}</p>
{#if preparing}<p role="status">{$i18n.text('Проверяем файл…')}</p>
{:else if file}
  {#if canShare}<button onclick={() => void share()}>{$i18n.text('Поделиться файлом')}</button>
  {:else}<p>{$i18n.text('Этот браузер не поддерживает внешнюю отправку такого файла.')}</p><button onclick={download}>{$i18n.text('Скачать файл')}</button>{/if}
{/if}
{#if error}<p role="status">{$i18n.text(error)}</p>{/if}

<style>p { line-height:1.5; overflow-wrap:anywhere; }</style>
