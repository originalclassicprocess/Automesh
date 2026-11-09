<!-- Isolated legacy enrollment fixture; not used by the production entry. -->
<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import QrInput from '../application/QrInput.svelte';
  import NodeScanner from '../transport/NodeScanner.svelte';
  import { readQrImage } from '../transport/qr-reader';
  import { createPendingDeviceBrowser } from './pending-browser';
  import type { PendingDeviceVault } from './pending-vault';
  import { deviceComparisonCode } from './enrollment';
  import { webCryptoEnvironment } from '../core/ports';
  import DeviceChat from './DeviceChat.svelte';
  let { live = false }: { live?: boolean } = $props();
  const MARKER = 'automesh-device-lab-id-v1';
  let label = $state('Новое устройство'), password = $state(''), id = $state(''), owner = $state(''), approval = $state('');
  let vault = $state.raw<PendingDeviceVault | null>(null), host: ReturnType<typeof createPendingDeviceBrowser> | undefined;
  let request = $state(''), qr = $state(''), code = $state(''), scan = $state(false), busy = $state(false), error = $state(''), notice = $state('');
  let generation = 0, destroyed = false;
  let chatting = $state(false), linked = $state(false);
  function lock() { generation++; chatting = false; linked = false; host?.close(); host = undefined; vault = null; password = ''; request = ''; qr = ''; code = ''; approval = ''; busy = false; scan = false; }
  async function unlock(create: boolean) {
    if (busy || !password) return; const entered = password; lock(); busy = true; error = ''; notice = '';
    const token = generation, active = () => !destroyed && token === generation;
    let opened: ReturnType<typeof createPendingDeviceBrowser> | undefined;
    try {
      opened = createPendingDeviceBrowser({ trusted: true, isCurrent: active });
      const result = create ? await opened.create(label, entered) : await opened.open(id, entered);
      if (!active()) { result.close(); return; }
      host = opened; opened = undefined; vault = result; id = result.deviceId; localStorage.setItem(MARKER, id);
      request = JSON.stringify(result.request); const image = await QRCode.toDataURL(request, { width: 512, margin: 4, errorCorrectionLevel: 'L' });
      if (!active()) return; qr = image;
      if (result.owner) { owner = result.owner; linked = true; notice = live ? 'Устройство подключено. Можно открыть текстовые чаты.' : 'Подписанная привязка сохранена локально. Обычный чат ещё не использует этот экспериментальный ключ.'; }
    } catch { if (active()) { lock(); error = 'Не удалось открыть хранилище устройства. Проверьте пароль и доступ к локальному хранилищу.'; } }
    finally { opened?.close(); if (active()) busy = false; }
  }
  async function comparison() {
    if (!vault || busy) return; const active = vault, token = generation; busy = true; error = '';
    try {
      const request = active.request;
      const value = await deviceComparisonCode(owner, request, { ...webCryptoEnvironment(), now: () => request.record.createdAt });
      if (token === generation) code = value;
    } catch { if (token === generation) error = 'Введите точный адрес владельца с доверенного устройства.'; }
    finally { if (token === generation) busy = false; }
  }
  async function link() {
    if (!vault || busy || !code) return; const active = vault, token = generation; busy = true; error = '';
    try {
      if (new TextEncoder().encode(approval).length > 65536) throw new Error('limit');
      await active.link(JSON.parse(approval), owner, code);
      if (token === generation) { approval = ''; linked = true; notice = live ? 'Подтверждение сохранено. Откройте чаты: доступ и получение будут проверены через ноду.' : 'Подтверждение владельца проверено и сохранено. Для доставки нужен экспериментальный слой, в обычном приложении он ещё не включён.'; }
    } catch { if (token === generation) error = 'Ответ не подходит: другой владелец/устройство, истёкший список или отозванный доступ. Привязка не подтверждена.'; }
    finally { if (token === generation) busy = false; }
  }
  async function image(event: Event) {
    const picker = event.target as HTMLInputElement, file = picker.files?.[0]; picker.value = ''; if (!file) return;
    const token = generation;
    try { const text = await readQrImage(file); if (token === generation) approval = text; }
    catch { if (token === generation) error = 'QR не найден. Вставьте содержимое ответа текстом.'; }
  }
  async function copy() { try { await navigator.clipboard.writeText(request); notice = 'Заявка скопирована.'; } catch { error = 'Выделите и скопируйте текст заявки вручную.'; } }
  onMount(() => {
    id = localStorage.getItem(MARKER) ?? '';
    const hide = () => { if (document.hidden) lock(); }; document.addEventListener('visibilitychange', hide);
    return () => { destroyed = true; lock(); document.removeEventListener('visibilitychange', hide); };
  });
</script>
{#if chatting && vault && live}
  <DeviceChat {vault} {lock} />
{:else}
<section aria-label={$i18n.text("Подключение нового устройства")}>
  <h2>{live ? $i18n.text("Подключить устройство") : $i18n.text("Новое устройство · эксперимент")}</h2>
  <p>{$i18n.text("Здесь нужен только собственный пароль нового устройства. Seed и пароль владельца не передаются.")}</p>
  {#if !vault}
    <label>{$i18n.text("Название устройства")}<input bind:value={label} maxlength="64" autocomplete="off" /></label>
    <label>{$i18n.text("Пароль этого устройства")}<input type="password" bind:value={password} autocomplete="off" /></label>
    {#if id}<p class="address">{$i18n("m_8b42ee4fd16b", {v0: (id)})}</p><button type="button" disabled={busy || !password} onclick={() => unlock(false)}>{$i18n.text("Разблокировать устройство")}</button>{/if}
    <button type="button" disabled={busy || !password} onclick={() => unlock(true)}>{$i18n.text("Создать новую заявку")}</button>
  {:else}
    {#if linked && live}<button class="primary" type="button" onclick={() => chatting = true}>{$i18n.text("Открыть чаты")}</button>{/if}
    <p class="address">{$i18n("m_622ed6b6fced", {v0: (id)})}</p>
    <img src={qr} alt={$i18n.text("QR заявки нового устройства")} />
    <label>{$i18n.text("Содержимое заявки")}<textarea readonly value={request} rows="3"></textarea></label><button type="button" onclick={copy}>{$i18n.text("Скопировать заявку")}</button>
    <label>{$i18n.text("Адрес владельца")}<input bind:value={owner} oninput={() => code = ''} autocomplete="off" /></label>
    <button type="button" disabled={busy || !owner} onclick={comparison}>{$i18n.text("Показать код проверки")}</button>
    {#if code}<strong class="code">{code}</strong><p>{$i18n.text("Этот код должен совпасть на устройстве владельца.")}</p>{/if}
    <QrInput bind:value={approval} label={$i18n.text("Ответ владельца")} multiline maxlength={65536} disabled={busy}
      onScan={() => scan = true} onImage={image} />
    {#if scan}<NodeScanner label={$i18n.text("QR ответа владельца")} onClose={() => scan = false} onResult={value => { approval = value; scan = false; }} />{/if}
    <button type="button" disabled={busy || !approval || !code} onclick={link}>{$i18n.text("Проверить и сохранить привязку")}</button>
    <button type="button" onclick={lock}>{$i18n.text("Заблокировать устройство")}</button>
  {/if}
  {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}{#if notice}<p role="status">{$i18n.text(notice)}</p>{/if}
</section>
{/if}
<style>
  section{max-width:760px;margin:20px auto;padding:16px;border:1px solid var(--line);border-radius:18px}label{display:block;margin:12px 0}input,textarea{width:100%;box-sizing:border-box;display:block;margin-top:6px;border-radius:14px}button{min-height:44px;margin:4px 6px 4px 0;border-radius:14px}img{width:100%;max-width:360px;height:auto}.address{overflow-wrap:anywhere;font-size:13px}.code{display:block;margin:12px 0;font-size:24px;letter-spacing:2px}
</style>
