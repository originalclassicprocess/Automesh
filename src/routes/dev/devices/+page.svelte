<script lang="ts">
  import { onMount } from 'svelte';
  import DeviceManager from '$lib/devices/LegacyDeviceManager.svelte';
  import NewDevice from '$lib/devices/LegacyNewDevice.svelte';
  import { WebCryptoIdentity } from '$lib/identity/webcrypto';
  import { accountIdFromPublicKey } from '$lib/addressing/account-id.js';
  import { openBrowserOwnerDevices } from '$lib/devices/owner-browser';
  import '$lib/application/application-ui.css';
  let owner = $state(''), store = $state.raw<Awaited<ReturnType<typeof openBrowserOwnerDevices>> | null>(null);
  let error = $state('');
  onMount(() => {
    let active = true; const signer = new WebCryptoIdentity();
    void (async () => {
      const root = new Uint8Array(32); root[31] = 42; // Public fixture, NEVER a user account.
      try {
        await signer.fromSeed(root); const id = await accountIdFromPublicKey(await signer.getPublicKeyBytes());
        const opened = await openBrowserOwnerDevices({ root, owner: id, signer, trusted: true, isCurrent: () => active });
        if (!active) { opened.close(); return; } owner = id; store = opened;
      } catch { if (active) error = 'Не удалось открыть тестовое хранилище.'; }
      finally { root.fill(0); }
    })();
    return () => { active = false; store?.close(); signer.dispose(); };
  });
</script>
<main><p>Только локальная проверка. Публичный тестовый владелец, не ваш аккаунт.</p>
  <NewDevice />
  {#if store}<DeviceManager {owner} {store} />{/if}{#if error}<p role="alert">{error}</p>{/if}
</main>
