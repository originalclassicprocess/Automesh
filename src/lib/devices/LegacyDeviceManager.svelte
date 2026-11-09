<!-- Isolated historical fixture only; production uses owner-initiated pairing. -->
<script lang="ts">
  import {locale as uiLocale} from '$lib/i18n/language';
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import QRCode from 'qrcode';
  import QrInput from '../application/QrInput.svelte';
  import NodeScanner from '../transport/NodeScanner.svelte';
  import { readQrImage } from '../transport/qr-reader';
  import type { OwnerDeviceStore } from './owner-store';
  import { verifyDeviceRequest, deviceComparisonCode } from './enrollment';
  import { webCryptoEnvironment } from '../core/ports';
  import type { SignedObject } from '../core/objects';
  import { deviceLink, readDeviceLink } from './links';
  let { owner, store, publish, invitation, initialRequest = '', live = false, transferContacts }: { owner: string; store: OwnerDeviceStore; publish?: () => Promise<SignedObject>;
    invitation?: () => Promise<SignedObject>; initialRequest?: string; live?: boolean; transferContacts?: () => Promise<void> } = $props();
  let items = $state<Awaited<ReturnType<OwnerDeviceStore['list']>>>([]), input = $state(''), scan = $state(false);
  let checked = $state<SignedObject | null>(null), code = $state(''), matched = $state('');
  let busy = $state(false), error = $state(''), notice = $state(''), output = $state(''), qr = $state('');
  let revokeId = $state(''); let generation = 0, destroyed = false;
  let confirmed = $state(false), invite = $state(''), inviteQr = $state(''), creating = $state(false), appliedRequest = '';
  let shareContacts = $state(true);
  let inputTimer: ReturnType<typeof setTimeout> | undefined;
  const current = (token: number) => !destroyed && token === generation;
  function resetCheck() { generation++; checked = null; code = ''; matched = ''; confirmed = false; output = ''; qr = ''; error = ''; busy = false; }
  function inputChanged() {
    resetCheck(); clearTimeout(inputTimer);
    inputTimer = setTimeout(() => { if (input && !busy && !checked) void inspect(); }, 400);
  }
  async function createInvite() {
    if (!invitation || creating) return; creating = true; error = ''; const token = generation;
    try {
      const value = await invitation(); if (!current(token)) return;
      const link = deviceLink({ kind: 'invite', value }, location.origin);
      const image = await QRCode.toDataURL(link, { width: 768, margin: 4, errorCorrectionLevel: 'M' });
      if (current(token)) { invite = link; inviteQr = image; }
    } catch { if (current(token)) error = 'Не удалось подготовить приглашение. Проверьте подключение устройств к ноде и повторите.'; }
    finally { if (current(token)) creating = false; }
  }
  async function copyInvite() { try { await navigator.clipboard.writeText(invite); notice = 'Ссылка подключения скопирована. Отправьте её на своё новое устройство.'; } catch { error = 'Выделите и скопируйте ссылку вручную.'; } }
  $effect(() => { if (initialRequest && initialRequest !== appliedRequest) { appliedRequest = initialRequest; input = initialRequest; inputChanged(); } });
  async function refresh() { items = await store.list(); }
  async function inspect() {
    clearTimeout(inputTimer);
    resetCheck(); const token = generation; busy = true;
    try {
      if (new TextEncoder().encode(input).length > 16384) throw new Error('limit');
      let value: unknown;
      if (input.trim().startsWith('{')) value = JSON.parse(input);
      else { const link = readDeviceLink(input.trim()); if (link.kind !== 'request' || link.owner !== owner) throw new Error('owner'); value = link.value; }
      const request = await verifyDeviceRequest(value, webCryptoEnvironment());
      const comparison = await deviceComparisonCode(owner, request, webCryptoEnvironment());
      if (!current(token)) return; checked = request; code = comparison;
      if (live && invitation && !invite) void createInvite();
    } catch { if (current(token)) error = 'Заявка повреждена или просрочена. Создайте новую на другом устройстве.'; }
    finally { if (current(token)) busy = false; }
  }
  async function approve() {
    if (!checked || busy || (live ? !confirmed : matched.trim().toUpperCase() !== code)) return;
    const request = checked, token = generation; busy = true; error = '';
    try {
      const certificate = await store.approve(request, { approved: true, comparisonCode: live ? code : matched.trim().toUpperCase() });
      const membership = await (publish?.() ?? store.publish());
      if (!current(token)) return;
      output = JSON.stringify({ type: 'automesh-device-approval-prototype-v1', certificate, membership });
      try { qr = await QRCode.toDataURL(output, { width: 512, margin: 4, errorCorrectionLevel: 'L' }); }
      catch { qr = ''; }
      if (!current(token)) return;
      checked = null; code = ''; matched = ''; input = ''; await refresh();
      notice = live ? 'Готово. Новое устройство автоматически получит разрешение с ноды и откроет чаты. Передавать ответ вручную не нужно.' : 'Разрешение сохранено. Это ещё не подключение доставки: экспериментальный протокол не включён в обычном чате.';
      if (live && shareContacts && transferContacts) {
        try { await transferContacts(); } catch { if (current(token)) notice += ' Передача контактов пока не завершена; проверьте ноду и повторите её.'; }
      }
    } catch { if (current(token)) error = 'Разрешение не выдано: проверьте срок заявки, код и доступность хранилища.'; }
    finally { if (current(token)) busy = false; }
  }
  async function revoke() {
    if (!revokeId || busy) return; const id = revokeId, token = generation; busy = true;
    try { await store.revoke(id, true); if (publish) await publish(); if (current(token)) { revokeId = ''; await refresh(); notice = live ? 'Нода подтвердила отзыв доступа. Уже полученные данные не удаляются.' : 'Отзыв сохранён. Его ещё требуется распространить получателям; уже полученные данные не удаляются.'; } }
    catch { if (current(token)) error = 'Отзыв на ноде не подтверждён. Повторите операцию; локальный запрет мог уже сохраниться.'; }
    finally { if (current(token)) busy = false; }
  }
  async function renew(id: string) {
    if (busy) return; busy = true; error = '';
    try { await store.renew(id, true); if (publish) await publish(); await refresh(); notice = 'Разрешение продлено на 30 дней. Сид на другое устройство не передаётся.'; }
    catch { error = 'Продление на ноде не подтверждено. Повторите операцию.'; }
    finally { busy = false; }
  }
  async function image(event: Event) {
    const picker = event.target as HTMLInputElement, file = picker.files?.[0]; picker.value = '';
    if (!file) return; const token = generation;
    try { const result = await readQrImage(file); if (current(token)) { input = result; await inspect(); } }
    catch { if (current(token)) error = 'QR не найден. Можно вставить текст заявки.'; }
  }
  async function copy() { try { await navigator.clipboard.writeText(output); notice = 'Содержимое скопировано.'; } catch { error = 'Не удалось скопировать. Выделите текст вручную.'; } }
  onMount(() => {
    void refresh().catch(() => { error = 'Список недоступен: права не подтверждены.'; });
    const hide = () => { if (document.hidden) scan = false; };
    document.addEventListener('visibilitychange', hide);
    return () => { destroyed = true; generation++; clearTimeout(inputTimer); document.removeEventListener('visibilitychange', hide); };
  });
</script>
<section class="devices" aria-label={$i18n.text("Устройства аккаунта")}>
  <h2>{$i18n.text("Устройства аккаунта")}</h2>
  <p class="muted">{live ? $i18n.text("Тестовая версия: независимые устройства для текстовых чатов. Первое устройство не требуется держать онлайн. Разрешение действует 30 дней; для повторного подключения понадобится владелец. Вложения, звонки и перенос старой истории пока доступны только на основном устройстве.") : $i18n.text("Экспериментальная панель. Управление разрешениями готово локально; обычные чаты пока работают по прежней схеме.")}</p>
  <p class="address">{$i18n("m_79a82ad5e0f4", {v0: (owner)})}</p>
  <div class="card">
    <h3>{$i18n.text("Добавить устройство")}</h3>
    {#if live}
      <p>{$i18n.text("Начните здесь или покажите заявку, созданную на новом устройстве. Сид и пароль аккаунта не передаются.")}</p>
      <button type="button" class="primary" disabled={!invitation || creating || busy} onclick={createInvite}>{creating ? $i18n.text("Готовим приглашение…") : $i18n.text("Подключить ещё устройство")}</button>
      {#if !invitation}<p class="muted">{$i18n.text("Список доступен. Для выдачи новых разрешений сначала восстановите подключение к ноде выше.")}</p>{/if}
      {#if invite}
        <p>{$i18n.text("1. Отсканируйте этот QR новым устройством или отправьте ему ссылку. Приглашение действует 10 минут.")}</p>
        <img src={inviteQr} alt={$i18n.text("QR подключения ещё одного устройства")} />
        <label>{$i18n.text("Ссылка подключения")}<input readonly value={invite} /></label><button type="button" onclick={copyInvite}>{$i18n.text("Скопировать ссылку подключения")}</button>
        <p>{$i18n.text("2. На новом устройстве создайте заявку. Отсканируйте её здесь и подтвердите совпадение кода.")}</p>
      {/if}
    {:else}<p>{$i18n.text("Создайте заявку на новом устройстве. Seed и пароль владельца туда вводить не нужно.")}</p>{/if}
    <QrInput bind:value={input} label={$i18n.text("Заявка нового устройства")} multiline maxlength={16384} disabled={busy}
      onInput={inputChanged} onScan={() => scan = true} onImage={image} />
    {#if scan}<NodeScanner label={$i18n.text("QR заявки устройства")} onClose={() => scan = false} onResult={value => { scan = false; input = value; void inspect(); }} />{/if}
    <button type="button" disabled={!input || busy} onclick={inspect}>{$i18n.text("Проверить заявку")}</button>
    {#if checked}
      <div class="confirmation">
        <h3>{(checked.record.body as Record<string, string>).label}</h3>
        <p class="address">{$i18n("m_622ed6b6fced", {v0: (checked.record.author)})}</p>
        <p>{$i18n.text("Сравните код на обоих устройствах. Подтверждайте только собственное устройство.")}</p>
        <strong class="code">{code}</strong>
        {#if live}<label class="code-confirm"><input type="checkbox" bind:checked={confirmed} /> {$i18n.text("Код совпадает с кодом на моём новом устройстве")}</label>
        {:else}<label>{$i18n.text("Код с нового устройства")}<input bind:value={matched} autocomplete="off" placeholder="XXXX-XXXX-XXXX" /></label>{/if}
        <p>{$i18n.text("Права: сообщения. Управлять устройствами или восстановлением это разрешение не позволяет.")}</p>
        {#if live && transferContacts}<label class="code-confirm"><input type="checkbox" bind:checked={shareContacts} /> {$i18n.text("Передать название профиля и контакты по зашифрованному каналу")}</label>{/if}
        <button type="button" class="primary" disabled={busy || (live ? !confirmed : matched.trim().toUpperCase() !== code)} onclick={approve}>{$i18n.text("Подтвердить устройство")}</button>
        <button type="button" disabled={busy} onclick={resetCheck}>{$i18n.text("Отмена")}</button>
      </div>
    {/if}
  </div>
  <div class="card">
    <h3>{$i18n.text("Выданные разрешения")}</h3>
    {#if live && transferContacts}<button type="button" disabled={busy} onclick={async () => { busy = true; try { await transferContacts(); notice = 'Профиль и контакты поставлены в зашифрованную очередь подключённых устройств.'; } catch { error = 'Передача пока не завершена. Проверьте ноду и повторите.'; } finally { busy = false; } }}>{$i18n.text("Передать профиль и контакты")}</button>{/if}
    {#if !items.length}<p class="muted">{$i18n.text("Дополнительных устройств пока нет.")}</p>{/if}
    {#each items as item (item.id)}
      <div class="device-row">
        <div><strong>{item.label}</strong><p class="address">{item.device}</p><small><span>{item.status === 'revoked' ? $i18n.text("Доступ отозван") : item.status === 'expired' ? $i18n.text("Срок разрешения истёк") : live ? $i18n.text("Подключено · текстовые сообщения") : $i18n.text("Разрешено · доставка ещё не включена")}</span> · {new Date(item.expiresAt).toLocaleDateString($uiLocale)}</small></div>
        {#if live && item.status !== 'revoked'}<button type="button" disabled={busy} onclick={() => void renew(item.id)}>{$i18n.text("Продлить на 30 дней")}</button>{/if}
        {#if item.status !== 'revoked'}<button type="button" disabled={busy} onclick={() => revokeId = item.id} aria-label={$i18n("m_a212077acc0d", {v0: (item.label)})}>{$i18n.text("Отозвать доступ")}</button>{/if}
      </div>
    {/each}
    {#if revokeId}<div class="confirmation" role="group" aria-label={$i18n.text("Подтверждение отзыва")}><p>{$i18n.text("Запретить этому устройству новые сообщения? Уже сохранённые им данные удалить удалённо нельзя.")}</p>
      <button type="button" disabled={busy} onclick={revoke}>{$i18n.text("Да, отозвать доступ")}</button><button type="button" disabled={busy} onclick={() => revokeId = ''}>{$i18n.text("Отмена")}</button></div>{/if}
  </div>
  {#if output}<details class="card" open={!live}><summary>{$i18n.text("Передать ответ вручную, если автоматическое получение недоступно")}</summary><h3>{$i18n.text("Ответ новому устройству")}</h3>
    {#if qr}<img src={qr} alt={$i18n.text("QR подписанного разрешения")} />{:else}<p>{$i18n.text("Ответ слишком большой для одного QR. Передайте его текстом.")}</p>{/if}
    <label>{$i18n.text("Содержимое ответа")}<textarea readonly value={output} rows="3"></textarea></label><button type="button" onclick={copy}>{$i18n.text("Скопировать содержимое")}</button>
  </details>{/if}
  {#if notice}<p role="status">{$i18n.text(notice)}</p>{/if}{#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
</section>
<style>
  .code-confirm{display:flex;gap:10px;align-items:center}.code-confirm input{display:inline-block;width:22px;height:22px;margin:0;flex-shrink:0}
  .devices{max-width:760px;margin:auto;padding:16px}.card,.confirmation{padding:16px;border:1px solid var(--line);border-radius:18px;margin:14px 0}.confirmation{background:var(--soft)}.muted,small{color:var(--muted)}.address{overflow-wrap:anywhere;font-size:13px}.device-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}.device-row:last-child{border-bottom:0}.device-row>div{min-width:0}.device-row button{flex-shrink:0}.code{display:block;font-size:24px;letter-spacing:2px;margin:12px 0}label{display:block;margin:12px 0}input,textarea{display:block;width:100%;box-sizing:border-box;margin-top:6px;border-radius:14px}button{min-height:44px;margin:4px 6px 4px 0;border-radius:14px}img{width:100%;max-width:360px;height:auto}.primary{background:var(--accent);color:var(--on-accent)}@media(max-width:480px){.device-row{align-items:stretch;flex-direction:column}.devices{padding:10px}}
</style>
