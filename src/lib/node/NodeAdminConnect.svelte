<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onDestroy } from 'svelte';
  import { homeNodeUrl, inspectHomeNode, requireNodeNetwork } from './client';
  import { parseAdminConnect, type AdminConnect } from './admin-connect';
  import NodeScanner from '$lib/transport/NodeScanner.svelte';
  import { readQrImage } from '$lib/transport/qr-reader';
  import QrInput from '$lib/application/QrInput.svelte';
  let { internetEnabled, onRequest }: { internetEnabled: boolean; onRequest(request: AdminConnect): void } = $props();
  let input = $state(''), panelUrl = $state(''), scanner = $state(false), busy = $state(false), error = $state('');
  let controller: AbortController | undefined, alive = true;
  onDestroy(() => { alive = false; controller?.abort(); });
  async function connect(value = input) {
    if (busy) return; error = ''; panelUrl = ''; scanner = false;
    try {
      const request = parseAdminConnect(value);
      if (request) { requireNodeNetwork(request.url, !internetEnabled); input = ''; onRequest(request); return; }
      const url = homeNodeUrl(value); requireNodeNetwork(url, !internetEnabled);
      busy = true; controller = new AbortController();
      const timer = setTimeout(() => controller?.abort(), 10000);
      try { const info = await inspectHomeNode(url, controller.signal); if (alive) {
        if (!info.adminPanel) throw new Error('panel_unavailable'); panelUrl = url;
      } } finally { clearTimeout(timer); }
    } catch (failure) { if (alive) error = failure instanceof Error && failure.message === 'internet_disabled'
      ? 'Включите «Интернет + LAN» для серверной ноды.' : failure instanceof Error && failure.message === 'panel_unavailable'
      ? 'Эта нода не предоставляет веб-панель. Для домашней Windows-ноды используйте её окно на ПК.'
      : 'Нужен HTTPS-адрес ноды или действующая ссылка/QR подтверждения из её панели.'; }
    finally { if (alive) busy = false; }
  }
  async function image(event: Event) {
    const field = event.currentTarget as HTMLInputElement, file = field.files?.[0]; field.value = '';
    try { if (file) { const value = await readQrImage(file); if (alive) await connect(value); } } catch { if (alive) error = 'Не удалось прочитать QR.'; }
  }
</script>
<p>{$i18n.text("Управление — только для владельца ноды. Чтобы просто отправлять сообщения, выберите «Подключить профиль».")}</p>
<QrInput bind:value={input} label={$i18n.text("Адрес ноды или ссылка подтверждения")} maxlength={2048} disabled={busy}
  onInput={()=>{panelUrl='';error='';}} onScan={()=>scanner=!scanner} onImage={image} />
<div class="actions"><button class="primary" onclick={() => connect()} disabled={busy || !input.trim()}>{busy ? $i18n.text("Проверяем…") : $i18n.text("Продолжить")}</button></div>
{#if scanner}<NodeScanner label={$i18n.text("QR входа в управление нодой")} onResult={connect} onClose={() => scanner = false} />{/if}
{#if panelUrl}<p><a href={panelUrl} target="_blank" rel="noopener noreferrer">{$i18n.text("Открыть панель ноды → Войти через Automesh")}</a></p>{/if}
{#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
<details><summary>{$i18n.text("Как назначить администратора")}</summary><p>{$i18n.text("Возьмите код назначения в закрытых настройках своей ноды. В её панели выберите «Войти через Automesh», сравните код на обоих экранах и подтвердите профиль.")}</p><p>{$i18n.text("Для каждой ноды права выдаются отдельно. Простого посещения панели или приглашения для доставки недостаточно.")}</p></details>
<style>.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}p{line-height:1.5;overflow-wrap:anywhere}details{margin-top:16px}</style>
