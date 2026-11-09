<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onDestroy } from 'svelte';
  import CompactDialog from '$lib/application/CompactDialog.svelte';
  import type { IdentityProvider } from '$lib/identity/identity';
  import { approveAdminConnect, type AdminConnect } from './admin-connect';
  let { request, address, signer, internetEnabled, onClose, onApproved = async () => {} }: { request: AdminConnect; address: string;
    signer(): IdentityProvider | null; internetEnabled: boolean; onClose(): void; onApproved?(request: AdminConnect): Promise<void> } = $props();
  let code = $state(''), busy = $state(false), error = $state(''), done = $state(false), compared = $state(false);
  const controller = new AbortController();
  onDestroy(() => { controller.abort(); code = ''; });
  async function approve() {
    if (busy || done || !compared) return; busy = true; error = '';
    const account = address, identity = signer(), timeout = setTimeout(() => controller.abort(), 15000);
    try {
      await approveAdminConnect(request, account, () => address === account ? signer() : null, code, controller.signal, !internetEnabled);
      if (!controller.signal.aborted && signer() === identity && address === account) {
        done = true; code = '';
        try { await onApproved(request); } catch { error = 'Вход подтверждён, но сохранить ноду в список не удалось. Панель уже можно использовать.'; }
      }
    } catch { if (!controller.signal.aborted) error = 'Вход не подтверждён. Проверьте профиль администратора, код и срок запроса. Для новой попытки откройте запрос заново.';
      else error = 'Запрос отменён или истёк. Откройте новый запрос из панели ноды.'; }
    finally { clearTimeout(timeout); busy = false; }
  }
</script>
<CompactDialog title={$i18n.text("Вход в панель ноды")} {onClose}>
  {#if done}<p role="status">{$i18n.text("Подтверждено. Вернитесь во вкладку ноды.")}</p>{#if error}<p role="status">{$i18n.text(error)}</p>{/if}<button onclick={onClose}>{$i18n.text("Готово")}</button>
  {:else}
    <p>{$i18n.text("Разрешить управление нодой")} <strong>{new URL(request.url).host}</strong>?</p>
    <p><small>{$i18n.text("Проверьте адрес и убедитесь, что сами открыли вход в этой панели. Доступ позволит управлять приглашениями и удалять очереди профилей. Пароль и seed остаются здесь.")}</small></p>
    <p style="overflow-wrap:anywhere"><small>{$i18n("m_69e7031c3969", {v0: (address)})}<br />{$i18n("m_e189210db1fe", {v0: (request.nodeId)})}</small></p>
    <p>{$i18n.text("Код сверки:")} <strong>{request.ticket.slice(0, 6).toUpperCase()}</strong></p>
    <label><input type="checkbox" bind:checked={compared} disabled={busy} /> {$i18n.text("Совпадает с кодом в открытой мной панели ноды")}</label>
    <label>{$i18n.text("Код назначения администратора")} <input type="password" bind:value={code} autocomplete="off" maxlength="32" placeholder={$i18n.text("Только при первом входе")} disabled={busy} /></label>
    {#if !internetEnabled}<p>{$i18n.text("Для входа включите режим «Интернет + LAN».")}</p>{/if}
    {#if error}<p role="alert">{$i18n.text(error)}</p>{/if}
    <button onclick={approve} disabled={busy || !internetEnabled || !compared}>{busy ? $i18n.text("Подтверждаем…") : $i18n.text("Разрешить управление")}</button>
    <button onclick={onClose}>{$i18n.text("Отмена")}</button>
  {/if}
</CompactDialog>
