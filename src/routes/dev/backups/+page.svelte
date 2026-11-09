<script lang="ts">
  import { restoreDataBackupToStore } from '$lib/backup/data-backup-browser';
  import type { DataBackupContents } from '$lib/backup/data-backup';
  import { deriveChatStoreKey } from '$lib/chat/local-store';
  import { onMount } from 'svelte';
  import FullBackup from '$lib/backup/FullBackup.svelte';
  import { accountFromMnemonic } from '$lib/application/account';
  import { sha256Hex } from '$lib/chat/file-transfer';
  import { encodeAccountId } from '$lib/addressing/bech32m.js';
  import type { BackupProfile } from '$lib/backup/full-backup';
  import '$lib/application/application-ui.css';
  const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const password = 'Public-fixture-password-2026';
  let owner = $state('');
  const peer = encodeAccountId(new Uint8Array(20).fill(2));
  const id = '10000000-0000-4000-8000-000000000001';
  const bytes = new Uint8Array([1,2,3,4]);
  onMount(() => { void (async () => { const account = await accountFromMnemonic(phrase); owner = account.accountId; account.identitySeed.fill(0); account.provider.dispose(); })(); });
  async function capture(): Promise<{ profiles: BackupProfile[] }> {
    return { profiles: [{ accountId: owner, data: { selfNickname: 'Fixture', readReceiptsEnabled:true, autoLockMinutes:30,
      aliases: { [peer]:'Fixture friend' }, declaredNames:{}, peerPublicKeys:{}, peerReadPreferences:{},
      chats:{ order:[peer],byPeer:{ [peer]:{ contact:'accepted',messages:[{ id,from:peer,direction:'incoming',timestamp:1,text:'Fixture attachment',
        file:{id,name:'fixture.bin',size:4,mime:'application/octet-stream',sha256:await sha256Hex(bytes)},fileStatus:'ready' }] } } } },
      files:new Map([[`${peer}:${id}`,bytes.slice()]]) }] };
  }
  async function restoreData(data: DataBackupContents, guard: () => void) {
    const account = await accountFromMnemonic(phrase);
    try {
      guard(); const key = await deriveChatStoreKey(account.identitySeed, owner); guard();
      await restoreDataBackupToStore(data, key, owner, guard); return true;
    } finally { account.identitySeed.fill(0); account.provider.dispose(); }
  }
</script>
<main>
  <h2>Полная копия · изолированная проверка</h2>
  <p>Публичный тестовый аккаунт; хранилища пользователей не читаются.</p>
  {#if owner}<FullBackup accountId={owner} nickname="Fixture" {capture} {restoreData} onClose={() => {}}
    readVault={async entered => entered === password ? { mnemonic:new TextEncoder().encode(phrase),metadata:null } : null} />{/if}
</main>
<style>main { max-width:720px; margin:auto; padding:16px; } </style>
