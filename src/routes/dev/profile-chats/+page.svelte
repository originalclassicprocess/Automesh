<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { replaceState } from '$app/navigation';
  import ProfileSwitcher from '$lib/profiles/ProfileSwitcher.svelte';
  import InboxSnapshot from '$lib/profiles/InboxSnapshot.svelte';
  import type { openProfileChatBrowserCheck } from '$lib/profiles/chat-browser-check';
  import type { ProfileInboxPage, InboxFocus } from '$lib/profiles/chat-context';
  import { ALL_CHATS_VIEW } from '$lib/profiles/presets';
  let fixture: Awaited<ReturnType<typeof openProfileChatBrowserCheck>> | undefined;
  let view = $state<ReturnType<Awaited<ReturnType<typeof openProfileChatBrowserCheck>>['state']> | null>(null);
  let busy = $state(false), status = $state(''), password = $state(''), text = $state('');
  let inbox = $state<ProfileInboxPage | null>(null), disposed = false;
  let allChats = $state(false);
  onMount(() => { void (async () => {
    try {
      const url = new URL(location.href), run = url.searchParams.get('run') || crypto.randomUUID(); url.searchParams.set('run',run);
      const { openProfileChatBrowserCheck } = await import('$lib/profiles/chat-browser-check');
      const opened = await openProfileChatBrowserCheck(run);
      if (disposed) { opened.close(); return; } fixture = opened; replaceState(url,{}); view = fixture.state(); inbox = await fixture.inbox();
    } catch (error) { status = String(error); }
  })(); });
  onDestroy(() => { disposed = true; fixture?.close(); });
  async function work(action: () => Promise<void>) {
    if (busy || !fixture) return; busy = true; status = '';
    try { await action(); if (!disposed) { view = fixture.state(); inbox = view.profile ? await fixture.inbox() : null; } }
    catch (error) { status = String(error); } finally { busy = false; }
  }
  async function select(id: string, entered: string) {
    if (busy || !fixture) return false; busy = true;
    try {
      if (id === ALL_CHATS_VIEW) {
        if (entered !== 'public-test-password') return false;
        inbox = await fixture.allInbox(); allChats = true; return true;
      }
      const ok = await fixture.switchProfile(id,entered); view = fixture.state(); inbox = await fixture.inbox(); if (ok) allChats = false; return ok;
    }
    catch (error) { status = String(error); return false; } finally { busy = false; }
  }
  async function page(index: number, focus?: InboxFocus) {
    if (busy || !fixture) return; busy = true;
    try { inbox = allChats ? await fixture.allInbox(index,focus) : await fixture.inbox(index,focus); } catch (error) { status = String(error); } finally { busy = false; }
  }
</script>
<svelte:head><title>Изолированная проверка чатов профилей</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<main>
  <h1>Чаты профилей — публичный локальный тест</h1>
  <p>Отдельные тестовые базы, вымышленные ключи. Настоящий сейф и история не открываются; соединений с сетью нет. Пароль только этого теста: public-test-password.</p>
  {#if status}<p role="alert">{status}</p>{/if}
  {#if view?.profile}
    <ProfileSwitcher profiles={view.registry.profiles} activeId={view.profile.id} trusted={true} {busy} {allChats} onSwitch={select} onManage={() => status = 'Управление проверяется отдельно в /dev/profiles.'} />
    <h2>{view.profile.name}</h2>
    <p>Адрес выбранного профиля: <code>{view.accountId}</code></p>
    <p>{view.network ? 'Адрес разрешён для сети; в тесте транспорт отключён.' : 'Главный профиль — только локально, сеть запрещена.'}</p>
    <label>Заметка в «Сохранённые»<input bind:value={text} /></label>
    <button disabled={busy || !text.trim()} onclick={() => work(async () => { await fixture!.addSaved(text); text = ''; })}>Сохранить заметку</button>
    {#each view.data?.chats.byPeer[view.accountId]?.messages ?? [] as message}<article>{message.text}</article>{/each}
    <button disabled={busy} onclick={() => work(() => fixture!.lock())}>Заблокировать тестовый профиль</button>
    {#if inbox}<InboxSnapshot snapshot={inbox} registry={view.registry} viewer={allChats ? view.registry.profiles.find(p => p.role === 'main')!.id : view.profile.id} onPage={(p,f) => void page(p,f)} onOpen={() => status = 'В этом тесте доступны только сохранённые заметки.'} />{/if}
  {:else if view}
    <label>Пароль тестовой связки<input type="password" bind:value={password} autocomplete="off" /></label>
    <button disabled={busy || !password} onclick={() => work(async () => { const entered = password; password = ''; if (!await fixture!.unlock(entered)) status = 'Неверный тестовый пароль'; })}>Разблокировать тест</button>
  {:else}<p>Подготовка изолированных данных…</p>{/if}
</main>
<style>
  main { max-width:850px; margin:20px auto; padding:20px; } label { display:grid; gap:8px; margin:16px 0; }
  code { overflow-wrap:anywhere; } article { padding:12px; margin:8px 0; border:1px solid #aaa; border-radius:10px; }
</style>
