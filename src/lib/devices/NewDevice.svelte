<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount } from 'svelte';
  import QrInput from '../application/QrInput.svelte';
  import NodeScanner from '../transport/NodeScanner.svelte';
  import { readQrImage } from '../transport/qr-reader';
  import { createPendingDeviceBrowser } from './pending-browser';
  import type { PendingDeviceVault } from './pending-vault';
  import { deviceComparisonCode } from './enrollment';
  import { webCryptoEnvironment } from '../core/ports';
  import { defaultDeviceLabel, readDeviceLink, verifyDeviceInvitation, type PairingChannel } from './links';
  import { pollDeviceApproval } from './approval-poll';
  import type { DirectoryAuthority } from './membership';
  import type { SignedObject } from '../core/objects';
  import { submitPairingRequest, pairingRequest, decryptPairingPacket, encryptPairingPacket, pairingComplete } from './pairing';
  import DeviceChat from './DeviceChat.svelte';
  import UnlockForm from '../application/UnlockForm.svelte';
  import { AutoUnlock } from '../application/auto-unlock';
  let { initialInvitation = null, onWorkspace = () => {}, onSaved = () => {} }: { initialInvitation?: SignedObject | null; onWorkspace?: (open: boolean) => void; onSaved?: () => void } = $props();
  const MARKER = 'automesh-device-lab-id-v1';
  let password = $state(''), label = $state(''), id = $state(''), owner = $state(''), nickname = $state(''), input = $state(''), code = $state('');
  let busy = $state(false), error = $state(''), notice = $state(''), scanner = $state(false), chatting = $state(false), invitationReady = $state(false);
  let rootSaved = $state(false), separateConfirmed = $state(false), vault = $state.raw<PendingDeviceVault | null>(null);
  let authority = $state.raw<DirectoryAuthority | null>(null);
  let pairing: PairingChannel | null = null, invitation: SignedObject | null = null;
  let host: ReturnType<typeof createPendingDeviceBrowser> | undefined, generation = 0, alive = true, polling = $state(false), submitted = false;
  let timer: ReturnType<typeof setTimeout> | undefined, idle: ReturnType<typeof setTimeout> | undefined, abort: AbortController | undefined;
  let autoBusy = $state(false);
  const autoUnlock = new AutoUnlock((entered, current) => open(false, true, entered, current));
  $effect(() => {
    if (id && !vault && !initialInvitation && !chatting) autoUnlock.schedule(password);
    else autoUnlock.cancel();
    return () => autoUnlock.cancel();
  });
  $effect(() => onWorkspace(chatting));
  function stop() { clearTimeout(timer); abort?.abort(); abort = undefined; }
  function lock() { autoUnlock.cancel(); autoBusy = false; generation++; stop(); chatting = false; host?.close(); host = undefined; vault = null; password = ''; code = ''; busy = false; scanner = false; submitted = false; pairing = null; invitation = null; authority = null; owner = ''; nickname = ''; input = ''; invitationReady = false; notice = ''; }
  async function accept(value: unknown, historical = false) {
    const signed = value as SignedObject, token = generation;
    const context = await verifyDeviceInvitation(signed, { ...webCryptoEnvironment(), ...(historical ? { now: () => signed.record.createdAt } : {}) });
    if (!alive || token !== generation) throw new Error('device_session_changed');
    if (!context.pairing || context.pairing.origin !== location.origin) throw new Error('device_pair_old_invite');
    if (owner && context.owner !== owner) throw new Error('device_owner_mismatch');
    authority = context.authority; pairing = context.pairing; invitation = signed; owner = context.owner; nickname = context.nickname; invitationReady = true; input = ''; error = '';
  }
  async function read() {
    if (busy) return; busy = true; error = ''; const token = generation;
    try { const link = readDeviceLink(input.trim()); if (link.kind !== 'invite') throw new Error('kind'); await accept(link.value); }
    catch { if (alive && token === generation) error = 'Нужен новый QR из открытого основного аккаунта: «Настройки → Безопасность → Подключить новое устройство». QR ноды и старые заявки не подходят.'; }
    finally { if (alive && token === generation) busy = false; }
  }
  async function open(create: boolean, automatic = false, entered = password, attemptCurrent = () => true) {
    if (busy || !entered || create && (!invitationReady || rootSaved && !separateConfirmed)) return;
    if (!automatic) autoUnlock.cancel();
    const selectedInvitation = invitation, expectedOwner = owner; if (create) lock();
    busy = true; autoBusy = automatic; error = ''; const token = generation, current = () => alive && token === generation;
    let adopted = false;
    const openingCurrent = () => current() && (adopted || create || attemptCurrent() && password === entered);
    let opened: ReturnType<typeof createPendingDeviceBrowser> | undefined;
    try {
      if (create) { if (!selectedInvitation) throw new Error('device_pair_old_invite'); await accept(selectedInvitation); if (!current()) return; }
      opened = createPendingDeviceBrowser({ trusted: true, isCurrent: openingCurrent });
      const session = create ? await opened.create(label.trim() || defaultDeviceLabel(navigator.userAgent), entered) : await opened.open(id, entered);
      if (!openingCurrent()) { session.close(); return; }
      adopted = true; autoBusy = false; password = '';
      host = opened; opened = undefined; vault = session; id = session.deviceId; localStorage.setItem(MARKER, id); onSaved();
      if (session.owner) { if (expectedOwner && session.owner !== expectedOwner) throw new Error('device_owner_mismatch'); owner = session.owner; chatting = true; return; }
      if (session.invitation) await accept(session.invitation, true); else if (invitation) await session.setInvitation(invitation);
      if (!current()) return; if (!pairing || !invitation) throw new Error('device_pair_old_invite');
      code = await deviceComparisonCode(owner, session.request, { ...webCryptoEnvironment(), now: () => session.request.record.createdAt });
      if (!current()) return; notice = 'Передаём заявку автоматически. Основной аккаунт должен оставаться открытым.'; schedule();
    } catch { if (current() && (create || attemptCurrent())) {
      if (create || adopted) lock();
      if (!automatic) error = 'Не удалось открыть подключение. Проверьте пароль (от 10 символов). Для незавершённой старой заявки нужен новый QR владельца; сохранённый аккаунт не удалён.';
    } }
    finally { opened?.close(); if (current()) { busy = false; autoBusy = false; } }
  }
  function schedule() { clearTimeout(timer); if (alive && vault && !chatting && !document.hidden) timer = setTimeout(() => void check(), 1200); }
  async function check() {
    if (polling || !vault || !pairing || !invitation || !code || document.hidden) return;
    const session = vault, channel = pairing, signed = invitation, token = generation; polling = true;
    const current = () => alive && token === generation;
    try {
      if (!submitted) { await submitPairingRequest(channel, signed, session.request); if (!current()) return; submitted = true; notice = 'Заявка появилась у владельца. Сравните код на обоих экранах и разрешите вход там. Здесь ничего больше сканировать не нужно.'; }
      const response = await pairingRequest(channel.origin, 'mine', { id: channel.id }, channel.token);
      if (!current() || !response.approval) return;
      const received = await decryptPairingPacket(channel, 'approval', response.approval) as { invitation: string; approval: unknown };
      if (!received || Object.keys(received).sort().join(',') !== 'approval,invitation' || received.invitation !== signed.record.id) throw new Error('device_pair_invalid');
      let approval = received.approval;
      if (authority) {
        const controller = new AbortController(); abort = controller; const timeout = setTimeout(() => controller.abort(), 5000);
        try { approval = await pollDeviceApproval(session, owner, authority, code, controller.signal) ?? approval; }
        catch { /* A fresh owner-bound grant can enroll; direct traffic still requires a live owner checkpoint, never cached authorization. */ }
        finally { clearTimeout(timeout); }
      }
      if (!current()) return; await session.link(approval, owner, code); if (!current()) return;
      if (current()) { error = ''; chatting = true; stop(); }
    } catch (failure) { if (current()) error = failure instanceof Error && failure.message === 'device_pair_claimed' ? 'Этот QR уже использован другим устройством. Создайте новый QR в основном аккаунте.' : failure instanceof Error && failure.message === 'device_pair_expired' ? 'Окно владельца закрыто или QR истёк. Откройте новое подключение у владельца.' : 'Связь прервалась. Повторяем автоматически; код и заявка сохранены.'; }
    finally { polling = false; if (current()) schedule(); }
  }
  async function confirmConnected() {
    const active = vault, channel = pairing, signed = invitation, token = generation;
    if (!active || !channel || !signed) return;
    try { const packet = await encryptPairingPacket(channel, 'complete', await pairingComplete(signed, active.request, active.signer));
      if (alive && token === generation) await pairingRequest(channel.origin, 'complete', { id: channel.id, packet }, channel.token);
    } catch { /* Saved authorization remains valid if the transient owner window is already gone. */ }
  }
  async function image(event: Event) {
    const picker = event.target as HTMLInputElement, file = picker.files?.[0]; picker.value = ''; if (!file) return;
    const token = generation;
    try { const value = await readQrImage(file); if (!alive || token !== generation) return; input = value; await read(); } catch { if (alive && token === generation) error = 'QR не найден. Вставьте ссылку владельца или выберите другое изображение.'; }
  }
  onMount(() => {
    label = defaultDeviceLabel(navigator.userAgent); id = localStorage.getItem(MARKER) ?? ''; rootSaved = localStorage.getItem('vault') !== null;
    if (initialInvitation) { const token = generation; void accept(initialInvitation).catch(() => { if (alive && token === generation) error = 'Нужен новый QR подключения из основного аккаунта.'; }); }
    const visibility = () => document.hidden ? stop() : schedule();
    const activity = () => { clearTimeout(idle); idle = setTimeout(lock, 15 * 60000); }; activity();
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', lock); window.addEventListener('pointerdown', activity); window.addEventListener('keydown', activity);
    return () => { alive = false; lock(); clearTimeout(idle); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', lock); window.removeEventListener('pointerdown', activity); window.removeEventListener('keydown', activity); };
  });
</script>
{#if chatting && vault}<DeviceChat {vault} {lock} initialNickname={nickname} onConnected={() => void confirmConnected()} />
{:else if id && !vault && !initialInvitation}
  <section class="auth-shell" aria-label={$i18n.text("Подключение нового устройства")}><UnlockForm bind:password {busy} editableWhileBusy={autoBusy} onUnlock={() => void open(false)} onInput={() => error = ''} />{#if error}<p role="alert">{$i18n.text(error)}</p>{/if}</section>
{:else}
  <section class="enrollment" aria-label={$i18n.text("Подключение нового устройства")}>
    <h2>{$i18n.text("Войти без сида")}</h2>
    {#if !invitationReady}<h3>{$i18n.text("Отсканируйте QR основного аккаунта")}</h3><p>{$i18n.text("На первом устройстве: «Настройки → Безопасность → Подключить новое устройство». Держите это окно открытым.")}</p>
      <QrInput bind:value={input} label={$i18n.text("QR или ссылка из основного аккаунта")} disabled={busy} maxlength={16384} onScan={() => scanner = true} onImage={image} />
      <button disabled={busy || !input.trim()} onclick={read}>{busy ? $i18n.text("Проверяем…") : $i18n.text("Продолжить")}</button>
    {:else if !vault}
      <p><strong>{nickname || $i18n.text("Ваш аккаунт")}</strong> · {authority ? $i18n.text("доставка через ноду, если она доступна") : $i18n.text("прямой режим без ноды")}</p>
      {#if rootSaved && !separateConfirmed}<p>{$i18n.text("В браузере уже сохранён аккаунт. Он не будет удалён или заменён.")}</p><button onclick={() => separateConfirmed = true}>{$i18n.text("Подключить отдельно, сохранив прежний аккаунт")}</button>
      {:else}<label>{$i18n.text("Пароль этого устройства")}<input type="password" bind:value={password} autocomplete="new-password" /></label>
        <p class="help-text">{$i18n.text("Придумайте локальный пароль. Сид и пароль основного аккаунта сюда не вводятся.")}</p>
        <details><summary>{$i18n.text("Название устройства")}</summary><input bind:value={label} aria-label={$i18n.text("Название устройства")} maxlength="64" /></details>
        <button class="primary" disabled={busy || !password} onclick={() => void open(true)}>{busy ? $i18n.text("Подключаем…") : $i18n.text("Подключить")}</button>{/if}
    {:else}<h3>{$i18n.text("Разрешите вход на первом устройстве")}</h3><strong class="code" aria-label={$i18n.text("Код сверки")}>{code}</strong>
      <p>{$i18n.text("Такой же код появится рядом с названием этого устройства у владельца. Сравните и нажмите там «Разрешить вход».")}</p>
      <p role="status">{$i18n.text(notice)}</p><button disabled={polling} onclick={() => void check()}>{$i18n.text("Повторить проверку")}</button><button onclick={lock}>{$i18n.text("Заблокировать")}</button>
    {/if}
    {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
    {#if scanner}<NodeScanner label={$i18n.text("QR из основного аккаунта")} onClose={() => scanner = false} onResult={value => { scanner = false; input = value; void read(); }} />{/if}
  </section>
{/if}
<style>
  .enrollment{max-width:620px;margin:20px auto;padding:22px;border:1px solid var(--line);border-radius:18px;background:var(--surface)}label{display:block;margin:12px 0}input{width:100%;box-sizing:border-box;margin-top:6px}button{min-height:44px;margin:6px 8px 6px 0}.primary{background:var(--accent);color:var(--on-accent)}.code{display:block;font-size:clamp(20px,5vw,28px);letter-spacing:2px;margin:18px 0;overflow-wrap:anywhere}
</style>
