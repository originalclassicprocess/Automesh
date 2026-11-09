<script lang="ts">
  import LanguageSettings from '$lib/i18n/LanguageSettings.svelte';
  import {tr as i18n} from '$lib/i18n/language';
  import SettingsMenu from '$lib/application/SettingsMenu.svelte';
  import SettingsLinks from '$lib/application/SettingsLinks.svelte';
  import { settingsMenu,settingsDescriptions,connectionMenu,mediaSettingsMenu,type SettingsSection } from '$lib/application/settings-structure';
  import NodesPanel from '$lib/node/NodesPanel.svelte';
  import HomeNodePanel from '$lib/node/HomeNodePanel.svelte';
  import DeliveryDiagnostics from '$lib/node/DeliveryDiagnostics.svelte';
  import ChoiceMenu from '$lib/application/ChoiceMenu.svelte';
  import QrInput from '$lib/application/QrInput.svelte';
  import PasswordField from '$lib/vault/PasswordField.svelte';
  import { identiconFor } from '$lib/addressing/identicon';
  import { idleCourierStatus } from '$lib/node/courier-controller';
  import { emptyCourierState } from '$lib/node/courier-state';
  import { emptyDeliveryDiagnostics } from '$lib/node/delivery-diagnostics';
  let section=$state<SettingsSection>('overview'), task=$state('overview'), narrow=$state(false), notice=$state('');
  let examplePassword=$state(''), exampleQr=$state(''), exampleLock=$state('15');
  const node={url:'https://node.example',nodeId:'a'.repeat(32),name:'Моя серверная нода'};
  const status={...idleCourierStatus(),connection:'connected' as const,stored:2};
  const props={address:'',signer:()=>null,addSignaling:async()=>{},trusted:true,offlineNode:null,offlineEnabled:false,
    offlineError:'',pendingCount:0,configureOffline:async()=>{},courierState:emptyCourierState(),courierError:'',configureCourier:async()=>{},
    courierStatus:status,waitingCount:0,receivingReady:true,receiveKeys:16};
  function select(id:string){section=id as SettingsSection;task='overview';notice='';}
</script>
<svelte:head><title>Настройки — локальный пример</title></svelte:head>
<main>
  <header><p>Локальный пример · без аккаунтов и запросов к нодам</p><label><input type="checkbox" bind:checked={narrow} /> Узкий экран</label></header>
  <section class="account-shell settings-surface" class:narrow>
    <h3>{$i18n.text(section==='overview'?'Настройки':settingsMenu.find(item=>item.id===section)?.label)}</h3>
    <SettingsMenu {section} items={settingsMenu} descriptions={settingsDescriptions} onSelect={select} />
    {#if section==='connection'}
      {#if task==='overview'}<SettingsLinks items={connectionMenu} label="Связь и ноды" onSelect={id=>task=id} />
      {:else}<button onclick={()=>task=['connect','outgoing','incoming'].includes(task)?'nodes':'overview'}>‹ {['connect','outgoing','incoming'].includes(task)?'Мои ноды':'Связь и ноды'}</button>{/if}
      {#if task==='nodes'}<NodesPanel managed={[node]} outgoing={node} inbox={null} enabled={true} {status} pending={2} busy={false}
        onConnect={()=>task='connect'} onOutgoing={()=>task='outgoing'} onIncoming={()=>task='incoming'} onForget={()=>notice='Пример: закладка не удаляется.'} />
      {:else if task==='connect'}<HomeNodePanel {...props} mode="outgoing" setupOnly />
      {:else if task==='incoming'}<HomeNodePanel {...props} mode="incoming" />
      {:else if task==='outgoing'}<HomeNodePanel {...props} mode="outgoing" />
      {:else if task==='diagnostics'}<DeliveryDiagnostics channel="Подключён" queueReachable={true} keys={16} diagnostics={emptyDeliveryDiagnostics()} expanded onRetry={()=>notice='Пример: запросы не отправляются.'} />
      {:else if task!=='overview'}<p>Серверы подключения и дополнительный LAN-ящик — в продвинутых параметрах приложения.</p>{/if}
    {:else if section==='files'}
      {#if task==='overview'}<SettingsLinks items={mediaSettingsMenu} label="Медиа и хранилище" onSelect={id=>task=id} />
      {:else}<button onclick={()=>task='overview'}>‹ Медиа и хранилище</button><p>Пример выбранного раздела: {mediaSettingsMenu.find(item=>item.id===task)?.label}</p>{/if}
    {:else if section==='account'}
      <div class="settings-section"><img src={identiconFor('settings-preview')} alt="Пример аватара" width="48" height="48"/><button disabled>Добавить фото</button></div>
      <div class="settings-section"><label class="settings-field">Ник<input value="Мой ник" readonly/></label><button disabled>Сохранить ник</button></div>
      <details class="settings-section"><summary>Мои профили</summary><p>Пример раскрывающегося блока.</p></details>
      <details class="settings-section"><summary>Открытый ключ профиля</summary><p>Открытый ключ находится здесь.</p></details>
    {:else if section==='security'}
      <div class="settings-section"><h4>Режим устройства</h4><p>Доверенное устройство</p><button disabled>Изменить режим</button></div>
      <div class="settings-section"><h4>Пароль</h4><label class="settings-field">Текущий пароль<input type="password" disabled placeholder="Текущий пароль"/></label>
        <PasswordField id="example-new-password" label="Новый пароль" bind:value={examplePassword} disabled />
        <label class="settings-field">Повторите новый пароль<input type="password" disabled placeholder="Повторите новый пароль"/></label><button class="primary" disabled>Сменить пароль</button></div>
      <div class="settings-section"><h4>Автоблокировка</h4><ChoiceMenu value={exampleLock} label="Автоблокировка" options={[{value:'1',label:'Через 1 минуту'},{value:'15',label:'Через 15 минут'},{value:'30',label:'Через 30 минут'}]} onChange={value=>exampleLock=value}/></div>
      <details class="settings-section"><summary>Перенос и восстановление списка профилей</summary><p>Пример. Реальные файлы и аккаунты здесь не открываются.</p></details>
    {:else if section==='privacy'}
      <div class="settings-section"><label><input type="checkbox" /> Делиться отметками о прочтении</label></div>
      <div class="settings-section"><label><input type="checkbox" /> Показывать моё имя при пересылке сообщений</label></div>
      <div class="settings-section"><label><input type="checkbox" checked /> Удалять личные метаданные изображений</label></div>
    {:else if section==='application'}<div class="settings-section"><LanguageSettings /></div>
    {:else if section!=='overview'}<p>Содержимое этого раздела проверяется в приложении; здесь показана навигация.</p>{/if}
    {#if section==='connection'&&task==='direct'}<div class="settings-section"><QrInput bind:value={exampleQr} label="Код прямого подключения" onScan={()=>notice='Пример: камера не открывается.'} onImage={()=>notice='Пример: файл не читается.'}/></div>{/if}
    {#if notice}<p role="status">{notice}</p>{/if}
  </section>
</main>
<style>
  main{max-width:1000px;margin:16px auto;padding:0 10px}header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;color:var(--muted);font-size:12px}.account-shell{width:100%;box-sizing:border-box}.narrow{max-width:390px;margin:16px auto}h3{font-size:20px}label{display:flex;align-items:center;gap:8px}
</style>
