<script lang="ts">
  import { tr as i18n } from '$lib/i18n/language';
  import { onMount, untrack, tick } from 'svelte';
  import { afterNavigate, pushState, replaceState } from '$app/navigation';
  import { page } from '$app/state';
  import { PageNavigation, historyPageState } from './page-navigation';
  import { navigationLevel, type NavigationView } from './navigation-level';
  import HelpInfo from './HelpInfo.svelte';
  import SettingsMenu from './SettingsMenu.svelte';
  import { settingsMenu, settingsDescriptions } from './settings-structure';
  import MessageCard from '$lib/chat/MessageCard.svelte';
  import Avatar from '$lib/chat/Avatar.svelte';
  import ConversationRow from '$lib/chat/ConversationRow.svelte';
  import ChatActivity from '$lib/chat/ChatActivity.svelte';
  import ThemeSelector from './ThemeSelector.svelte';
  import AboutProject from './AboutProject.svelte';
  import type {ChatEntry,Conversation} from '$lib/chat/session-chats';
  import MessageDelivery from '$lib/chat/MessageDelivery.svelte';
  import {messageStatus} from '$lib/chat/message-presentation';
  import MessageSelectionBar from '$lib/chat/MessageSelectionBar.svelte';
  import ChatIcon from '$lib/chat/ChatIcon.svelte';
  import OfflineKeyBadge from '$lib/chat/OfflineKeyBadge.svelte';
  import CompactDialog from './CompactDialog.svelte';
  import ConnectionIndicators from '$lib/transport/ConnectionIndicators.svelte';
  import AccountHeader from './AccountHeader.svelte';
  import ContactCard from '$lib/chat/ContactCard.svelte';
  import {contactLink} from '$lib/chat/contact-link';
  import QueueIndicator from '$lib/chat/QueueIndicator.svelte';
  import {queueIndicatorStates} from '$lib/chat/queue-indicator';
  import NodeQueueOverview from '$lib/chat/NodeQueueOverview.svelte';
  import {nodeInteractionGroups,nodeInteractionCounts} from '$lib/chat/node-queue-overview';
  let queueOpen=$state(false);
  const quotaExample={checkedAt:Date.now(),messages:36,quota:{protocol:'automesh-queue-quota-v1' as const,profileFiles:16,profileFileLimit:16,nodeFiles:16,nodeFileLimit:128,reservedBytes:5662310,maxBytes:67108864,profileMessages:36,profileMessageLimit:100,profileMessageBytes:10000,profileMessageByteLimit:4194304,nodeMessages:60,nodeMessageLimit:1000,nodeRecords:72,nodeRecordLimit:2000}};
  import ProfileSwitcher from '$lib/profiles/ProfileSwitcher.svelte';
  import { identiconFor } from '$lib/addressing/identicon';
  import { encodeAccountId } from '$lib/addressing/bech32m.js';
  import { idleCourierStatus } from '$lib/node/courier-controller';
  import { installFileDrop } from '$lib/chat/file-drop';
  import { autoSizeComposer } from '$lib/chat/composer-size';
  import { validateAttachmentBatch } from '$lib/chat/attachment-policy';
  import { selectEveryMessage, toggleSelection } from '$lib/chat/message-selection';
  let { standalone = false }: { standalone?: boolean } = $props();
  const messages = [{ id:'1', text:'Привет! Теперь у сообщения есть аккуратная рамка.', out:false },
    { id:'2', text:'Да. А в режиме выбора можно нажать прямо на сообщение.', out:true },
    { id:'3', text:'Назад из раздела вернёт в меню настроек, затем — в чат.', out:false }];
  const items = settingsMenu, descriptions = settingsDescriptions;
  const transferMessages:ChatEntry[]=[
    {id:'upload',from:'me',text:'',direction:'outgoing',timestamp:1,file:{id:'upload',name:'Archive.zip',mime:'application/zip',size:100000000,sha256:'a'.repeat(64)},delivery:'queued',courierStage:'uploading',fileStatus:'sending',fileProgress:54000000},
    {id:'queued',from:'me',text:'',direction:'outgoing',timestamp:2,file:{id:'queued',name:'Video.mp4',mime:'video/mp4',size:50000000,sha256:'b'.repeat(64)},fileStatus:'queued'},
    {id:'download',from:'peer',text:'',direction:'incoming',timestamp:3,file:{id:'download',name:'Photos.zip',mime:'application/zip',size:200000000,sha256:'c'.repeat(64)},fileStatus:'receiving',fileProgress:98000000},
    {id:'wait',from:'me',text:'Сообщение ждёт ключи',direction:'outgoing',timestamp:4,delivery:'queued',deliveryIssue:'keys_missing'},
  ];
  function exampleMessage(id:string,patch:Partial<ChatEntry>={}):ChatEntry {
    return {id,from:'me',text:'Тестовое сообщение',direction:'outgoing',timestamp:Date.UTC(2026,9,28,10,0),delivery:'queued',...patch};
  }
  function exampleFile(id:string,patch:Partial<ChatEntry>={}):ChatEntry {
    return exampleMessage(id,{text:'',file:{id,name:`Пример-${id}.zip`,mime:'application/zip',size:10000000,sha256:'a'.repeat(64)},fileStatus:'queued',...patch});
  }
  const demoChats:Array<{name:string;conversation:Conversation}>=[
    {name:'Мария',messages:transferMessages,connection:'connected',unread:3},
    {name:'Алексей',messages:[exampleMessage('stored-a',{delivery:'stored',text:'Сообщение принято нодой'}),exampleFile('upload-a',{courierStage:'uploading',fileStatus:'sending',fileProgress:7200000}),exampleMessage('wait-a',{deliveryIssue:'keys_missing',text:'Ждём ключи для следующей отправки'})],connection:'offline',unread:0},
    {name:'Елена',messages:[exampleFile('quota-e',{deliveryIssue:'node_profile_files_full'}),exampleMessage('stored-e',{delivery:'stored'}),exampleFile('receive-e',{direction:'incoming',fileStatus:'receiving',fileProgress:3500000})],connection:'connected',unread:2},
    {name:'Очень длинное имя собеседника',messages:[exampleFile('expired-d',{nodeQueue:'expired',fileStatus:'canceled'}),exampleMessage('stored-d',{delivery:'stored'}),exampleFile('upload-d',{courierStage:'uploading',fileStatus:'sending',fileProgress:2100000})],connection:'offline',unread:0},
    {name:'Игорь',messages:[exampleFile('cancel-i',{nodeQueue:'canceling',fileStatus:'canceled'}),exampleFile('receive-i',{direction:'incoming',fileStatus:'receiving',fileProgress:8900000}),exampleMessage('stored-i',{delivery:'stored'})],connection:'connected',unread:12},
    {name:'Анна',messages:[exampleMessage('canceled-n',{nodeQueue:'canceled'}),exampleMessage('retry-n',{deliveryIssue:'node_timeout',text:'Запрос к ноде повторится автоматически'}),exampleMessage('keys-n',{deliveryIssue:'keys_exhausted',text:'Ожидаем пополнение ключей'})],connection:'connecting',unread:0},
    {name:'Дмитрий',messages:[exampleFile('failed-d',{direction:'incoming',fileStatus:'failed',fileProgress:6000000}),exampleMessage('canceled-d',{nodeQueue:'canceled'}),exampleMessage('stored-dd',{delivery:'stored'})],connection:'offline',unread:1},
  ].map((chat,index)=>({name:chat.name,conversation:{peerAddress:encodeAccountId(Uint8Array.from({length:20},(_,byte)=>(byte*17+(index+11)*29)%256)),messages:chat.messages,draft:'',unread:chat.unread,connection:chat.connection as Conversation['connection'],error:'',sending:false,contact:'accepted'}}));
  let demoPeer=$state(demoChats[0].conversation.peerAddress);
  const activeDemo=$derived(demoChats.find(chat=>chat.conversation.peerAddress===demoPeer)??demoChats[0]);
  const demoQueueChats=demoChats.map(chat=>({peer:chat.conversation.peerAddress,name:chat.name,groups:nodeInteractionGroups(chat.conversation.messages,new Set())}));
  const demoQueueTotals=nodeInteractionCounts(demoQueueChats);
  const demoHeaderQueue={stored:demoQueueTotals.waiting,transmitting:demoQueueTotals.transmitting,retrying:demoQueueTotals.retrying,errors:demoQueueTotals.errors,stopped:demoQueueTotals.stopped,expired:demoQueueTotals.expired,canceling:demoQueueTotals.canceling};
  let demoMessageScroll=$state<HTMLDivElement>();
  let highlighted=$state('');
  function jumpDemoMessage(id:string){highlighted=id;demoMessageScroll?.querySelector(`[data-example-id="${id}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});}
  function openDemoChat(peer:string){demoPeer=peer;highlighted='';selection=false;selected=[];mobilePane='chat';visit();}
  let section = $state('overview'); let settings = $state(false); let selection = $state(false); let selected = $state<string[]>([]);
  let mobilePane = $state('chat'); let nav: PageNavigation<NavigationView>;
  let started = false;
  afterNavigate(() => { queueMicrotask(() => { if (nav && !started) { started = true; nav.start(route()); } }); });
  let networkOpen = $state(false), budgetOpen = $state(false), dropActive = $state(false), draft = $state('');
  let demoFiles = $state<string[]>([]), demoStatus = $state(''), demoNode = $state(false);
  const courierStatus = idleCourierStatus();
  let previewCopied=$state(false);
  let ownOpen = $state(false), demoProfile = $state('personal');
  const demoProfiles = ['Личный', 'Рабочий', 'Мой проект'].map((name, index) => ({
    id: index === 0 ? 'personal' : `example-${index}`, accountId: encodeAccountId(Uint8Array.from({ length:20 }, (_, byte) => (byte * 17 + index * 35) % 256)), index: index + 1,
    role: 'custom' as const, name, archived: false, createdAt: 1,
  }));
  const budget = $derived({ count: demoNode ? 16 : 0, available: demoNode, label: demoNode ? 'Нода · 16 ключей' : 'Нода не подключена',
    detail: 'Это пример счётчика. Обычная переписка онлайн не ограничена офлайн-ключами.' });
  function dropZone(node: HTMLElement) {
    return installFileDrop(node, { canDrop: () => !selection, target: () => 'example', onActive: active => dropActive = active,
      onFiles: files => { const error = validateAttachmentBatch(files, demoFiles.length); if (error) demoStatus = error;
        else { demoFiles = [...demoFiles, ...files.map(file => file.name)]; demoStatus = 'Тестовые файлы добавлены. Ничего не отправлено и не сохранено.'; } } });
  }
  function backToList() { selection=false; selected=[]; networkOpen=false; budgetOpen=false; mobilePane='list'; nav.returnToRoot(route()); }
  let narrow = $state(false);
  let narrowWidth = $state(390);
  let longName = $state(false);
  function route(): NavigationView { return { screen:'account', layer:networkOpen ? 'network' : budgetOpen ? 'budget' : selection ? 'selection' : '', view:settings ? 'profile' : 'chats', pane:mobilePane, peer:demoPeer, card:'', settings:section, gallery:'' }; }
  function visit() { nav.visit(route()); }
  function enterSettings() { selection=false; settings=true; section='overview'; visit(); }
  onMount(() => {
    nav = new PageNavigation({
      get state() { return untrack(() => page.state); },
      pushState(state) { pushState('', state as App.PageState); },
      replaceState(state) { replaceState('', state as App.PageState); },
      back() { window.history.back(); },
    }, value => { settings=value.view==='profile'; section=value.settings; networkOpen=false; budgetOpen=false; selection=value.layer==='selection'; if (!selection) selected=[]; mobilePane=value.pane;if(demoChats.some(chat=>chat.conversation.peerAddress===value.peer))demoPeer=value.peer; }, () => {}, () => 'public-interface-preview', navigationLevel);
    const pop = (e:PopStateEvent) => nav.pop(historyPageState(e.state));
    window.addEventListener('popstate', pop); return () => { nav.clear(); window.removeEventListener('popstate', pop); };
  });
</script>
{#if !standalone}
<p class="preview-note">{$i18n.text("Изолированный пример интерфейса. Без аккаунта, секретов, сети и сохранения сообщений.")}</p>
<label><input type="checkbox" bind:checked={narrow} /> {$i18n.text("Мобильная ширина")}</label>
<select aria-label={$i18n.text("Ширина примера")} bind:value={narrowWidth}>{#each [280,320,360,390,430,480,520,600,700,900,1100] as width}<option value={width}>{width} px</option>{/each}</select>
<label><input type="checkbox" bind:checked={longName} /> {$i18n.text("Длинное имя")}</label>
<label><input type="checkbox" bind:checked={demoNode} /> {$i18n.text("Пример подключённой ноды")}</label>
{/if}
<div class="preview-size" class:narrow class:standalone class:extra-narrow={narrow && narrowWidth <= 360} style:width={narrow ? `${narrowWidth}px` : undefined}>
<div class="page-shell">
  <div class="account-shell" class:chats={!settings&&!ownOpen}>
    <AccountHeader contactUrl={contactLink(demoProfiles.find(p=>p.id===demoProfile)!.accountId)} accountId={demoProfiles.find(p=>p.id===demoProfile)!.accountId} avatar={identiconFor(demoProfiles.find(p=>p.id===demoProfile)!.accountId)} nickname={longName?'Александр с очень длинным именем профиля':'Александр'} profile={demoProfiles.find(p=>p.id===demoProfile)?.name??'Личный'} expanded={ownOpen} onProfile={()=>ownOpen=!ownOpen}
      queueState={queueIndicatorStates(demoHeaderQueue)[0]} networkAvailable {settings} onSettings={()=>settings?nav.back():enterSettings()} panicDisabled lockDisabled onPanic={()=>{}} onLock={()=>{}}>
      {#snippet network()}

        <ConnectionIndicators compact responsive expanded={networkOpen} onToggle={()=>{networkOpen=true;visit();}} nodes={[]} directCount={1} serversEnabled={true} onOpen={enterSettings} courierEnabled={demoNode} {courierStatus} courierPending={0} trusted={true} receiveKeys={16}/>
        <QueueIndicator {...demoHeaderQueue} onOpen={()=>queueOpen=true} expanded={queueOpen} />
      {/snippet}
    </AccountHeader>
    {#if queueOpen}<CompactDialog title={$i18n.text("Очередь ноды")} onClose={()=>queueOpen=false}>
      <NodeQueueOverview nodeUrl="https://node.example.test" snapshot={{...quotaExample,messages:demoQueueTotals.waiting}} chats={demoQueueChats} onOpen={(peer,id)=>{queueOpen=false;openDemoChat(peer);void tick().then(()=>jumpDemoMessage(id));}} onClear={()=>demoStatus='Пример скрытия уведомлений'} />
    </CompactDialog>{/if}
    {#if ownOpen}
      <button type="button" onclick={()=>ownOpen=false}>{$i18n.text("← Назад к чату")}</button>
      <ProfileSwitcher inline profiles={demoProfiles} activeId={demoProfile} trusted={true}
        onSwitch={async(id,password,current)=>{if(password!=='demo-only-password'||current&&!current())return false;demoProfile=id;return true;}}
        onManage={()=>{ownOpen=false;enterSettings();}} />
      <ContactCard self accountId={demoProfiles.find(p=>p.id===demoProfile)!.accountId} nickname="Александр" alias="" qr="" contactUrl={contactLink(demoProfiles.find(p=>p.id===demoProfile)!.accountId)}
        copied={previewCopied} blocked={false} hasChat messages={[]} urls={{}} errors={{}}
        copy={()=>{void navigator.clipboard.writeText(demoProfiles.find(p=>p.id===demoProfile)!.accountId).then(()=>previewCopied=true);}}
        rename={()=>false} toggleBlock={()=>{}} openChat={()=>ownOpen=false} openMessage={()=>{}} preview={()=>({destroy(){}})} canOpen={()=>false}
        editOwn={()=>{ownOpen=false;enterSettings();}} share={()=>demoStatus='Пример ссылки на контакт'} changePhoto={()=>demoStatus='Пример фото'} openLibrary={()=>demoStatus='Пример библиотеки'}>
        {#snippet accountActions()}<button type="button" onclick={()=>demoStatus='Пример выхода'}>{$i18n.text("Выйти из аккаунта")}</button>{/snippet}
      </ContactCard>
    {:else if settings}
      <div class="settings-title"><h3>{section==='overview' ? $i18n.text("Настройки") : items.find(item=>item.id===section)?.label}</h3><HelpInfo label={$i18n.text("Справка: пример")} text={$i18n.text("Это общий компонент подсказки. В настоящем приложении описана конкретная функция.")} /></div>
      <SettingsMenu {section} {items} {descriptions} onSelect={id=> { section=id; visit(); }} />
      {#if section==='about'}<AboutProject />{/if}
      {#if section==='application'}<section class="settings-section"><h4>{$i18n.text("Внешний вид")}</h4><ThemeSelector /></section>{/if}
      {#if section!=='overview'}<div class="settings-section"><label>{$i18n.text("Пример поля")} <input placeholder={$i18n.text("Имя")} /></label><HelpInfo label={$i18n.text("Справка: поле")} text={$i18n.text("Ник виден вашим собеседникам, но не уникален.")} /></div>{/if}
    {:else}
      <div class="chat-layout" class:show-chat={mobilePane==='chat'} class:show-list={mobilePane==='list'}>
        <nav class="conversation-list" aria-label={$i18n.text("Пример чатов")}><input type="search" placeholder={$i18n.text("Имя контакта или Mesh ID")} /><div class="conversation-items">
          {#each demoChats as chat (chat.conversation.peerAddress)}
            <ConversationRow accountId={chat.conversation.peerAddress} name={chat.name} active={demoPeer===chat.conversation.peerAddress}
              conversation={chat.conversation} onOpen={()=>openDemoChat(chat.conversation.peerAddress)} />
          {/each}
        </div></nav>
        <section class="conversation-pane" use:dropZone aria-label={$i18n.text("Пример переписки")}>
          {#if dropActive}<div class="file-drop-hint">{$i18n.text("Отпустите тестовые файлы")}</div>{/if}
          <div class="chat-heading"><button class="chat-back" aria-label={selection ? $i18n.text("Отменить выбор") : $i18n.text("Назад ко всем чатам")} onclick={()=>selection ? nav.back() : backToList()}>←<span class="unread-badge">3</span></button>
            {#if selection}<MessageSelectionBar messages={messages} {selected} onToggleAll={()=>selected=selected.length===messages.length ? [] : selectEveryMessage(messages)}
              onForward={()=>demoStatus='Пример пересылки'} onDownload={()=>demoStatus='Пример скачивания'} onDelete={()=>demoStatus='Пример удаления — сообщения не изменены'} />
            {:else}<strong class="peer-heading"><Avatar accountId={demoPeer} size={32} /><span>{activeDemo.name}<br /><small class="peer-status">{activeDemo.conversation.connection==='connected'?$i18n.text("● На связи"):activeDemo.conversation.connection==='connecting'?$i18n.text("Подключаемся…"):$i18n.text("○ Не в сети")}</small></span></strong><button class="select-messages-button" aria-label={$i18n.text("Выбрать сообщения")} onclick={()=> { selection=true; selected=[]; visit(); }}><ChatIcon name="select" /></button>{/if}
          </div>
          {#key demoPeer}<ChatActivity messages={activeDemo.conversation.messages} onJump={jumpDemoMessage} onClear={()=>demoStatus='Пример скрытия уведомлений'} />{/key}
          <div class="message-scroll" bind:this={demoMessageScroll}>{#each messages as message}<MessageCard preview={message.text} outgoing={message.out} selecting={selection} selected={selected.includes(message.id)} onSelect={()=>selected=toggleSelection(selected,message.id)}><div class="message-header"><Avatar accountId={message.out?demoProfiles[0].accountId:demoPeer} size={18} /><span class="message-author">{message.out?$i18n.text("Вы"):activeDemo.name}</span><time>12:00</time></div><span class="message-text">{message.text}</span><div class="message-actions"><button title={$i18n.text("Только пример")} disabled>↩</button></div></MessageCard>{/each}
            {#each activeDemo.conversation.messages as message (message.id)}
              <div data-example-id={message.id} class:highlighted={highlighted===message.id}>
                <MessageCard preview={message.text||message.file?.name||''} outgoing={message.direction==='outgoing'} onSelect={()=>{}}>
                  <div class="message-header"><Avatar accountId={message.direction==='outgoing'?demoProfiles[0].accountId:demoPeer} size={18} /><span class="message-author">{message.direction==='outgoing'?$i18n.text("Вы"):activeDemo.name}</span><time>12:00</time></div>
                  <p class="example-message">{message.file?`📎 ${message.file.name}`:message.text}</p>
                  <div class="message-actions"><MessageDelivery status={messageStatus(message)} onDetails={()=>demoStatus=messageStatus(message).detail} /></div>
                </MessageCard>
              </div>
            {/each}
            {#each demoFiles as name}<p>{$i18n("m_bb257e9eff25", {v0: (name)})}</p>{/each}
          </div>
          <div class="composer"><div class="composer-controls composer-left"><OfflineKeyBadge {budget} configured={demoNode} connected={demoNode} onOpen={()=> { budgetOpen=true; visit(); }} /><button class="icon-button" disabled>📎</button></div><textarea rows="1" bind:value={draft} use:autoSizeComposer={draft} aria-label={$i18n.text("Пример сообщения")} placeholder={$i18n.text("Сообщение…")}></textarea><div class="composer-controls composer-right"><button class="icon-button" disabled>🎙</button><button class="primary send-button" aria-label={$i18n.text("Отправить пример")} onclick={()=> { draft=''; demoStatus='Тестовый текст не отправлен и не сохранён.'; }} disabled={!draft.trim()}><ChatIcon name="send" /></button></div></div>
        </section>
      </div>
    {/if}
    {#if networkOpen}<CompactDialog title={$i18n.text("Состояние сети")} onClose={()=>nav.back()}><ConnectionIndicators nodes={[]} directCount={1} serversEnabled={true} onOpen={()=> { networkOpen=false; enterSettings(); }} courierEnabled={demoNode} {courierStatus} courierPending={0} trusted={true} receiveKeys={16} /></CompactDialog>{/if}
    {#if budgetOpen}<CompactDialog title={$i18n.text("Офлайн-доставка")} onClose={()=>nav.back()}><p>{$i18n.system(budget.label)}</p><p>{$i18n.system(budget.detail)}</p></CompactDialog>{/if}
  </div>
</div>
</div>
{#if demoStatus}<p role="status">{demoStatus}</p>{/if}
<style>
  .preview-note { color:var(--muted); font-size:13px; }
  .example-message{font-size:14px;overflow-wrap:anywhere}.highlighted{outline:2px solid var(--accent);outline-offset:2px;border-radius:10px}
  .preview-size { margin-top:12px; max-width:100%; }
  .preview-size .account-shell.chats { height:620px; max-height:75dvh; }
  .preview-size.standalone { margin-top:0; }
  .standalone .account-shell.chats { height:calc(var(--app-height, 100dvh) - max(12px, env(safe-area-inset-top)) - max(12px, env(safe-area-inset-bottom))); max-height:none; }
  @media(max-width:700px) { .standalone .account-shell.chats { height:calc(var(--app-height, 100dvh) - max(8px, env(safe-area-inset-top)) - max(8px, env(safe-area-inset-bottom))); } }
  .narrow :global(.chat-layout) { flex-direction:column; }
  .narrow :global(.conversation-list) { flex:1; border:0; padding:0; }
  .narrow :global(.show-chat .conversation-list), .narrow :global(.show-list .conversation-pane) { display:none; }
  .narrow :global(.mobile-back) { display:inline-block; }
  .narrow :global(.chat-heading) { flex-wrap:nowrap; }
  .narrow :global(.account-shell) { padding:8px; }
  .narrow :global(.settings-label) { display:none; }
  .narrow :global(.selection-count small) { display:none; }
  .narrow :global(.header-actions), .narrow :global(.compact-chat-header) { gap:3px; }
  .narrow :global(.header-actions .icon-button), .narrow :global(.settings-button) { min-width:44px; width:44px; padding:6px; }
  .narrow :global(.composer textarea) { font-size:16px; }
</style>
