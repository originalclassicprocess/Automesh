<script lang="ts">
  import { onMount } from 'svelte';
  import { tr as i18n } from '$lib/i18n/language';
  import type { NotificationState } from './state';
  let {configuration,defaultProvider,available,status='',onEnable,onDisable,onTest}: {
    configuration:NotificationState;defaultProvider:string;available:boolean;status?:string;
    onEnable:(provider:string)=>Promise<void>;onDisable:()=>Promise<void>;onTest:()=>Promise<void>;
  }=$props();
  let busy=$state(false),message=$state(''),error=$state(''),custom=$state(''),advanced=$state(false),permission=$state('default'),supported=$state(false);
  onMount(()=>{supported='Notification'in window&&'PushManager'in window&&'serviceWorker'in navigator;permission='Notification'in window?Notification.permission:'unsupported';});
  const errors:Record<string,string>={notification_provider:'Провайдер не поддерживает уведомления Automesh. Проверьте адрес.',notification_storage:'Не удалось сохранить настройки уведомлений.',notification_subscription:'Браузер не подключил уведомления. Проверьте его настройки.',notification_rate:'Слишком много проверок. Попробуйте через минуту.'};
  async function enable(provider:string){
    if(busy)return;busy=true;error='';message='';
    try {
      // Permission must be requested directly in the user's click handler.
      if(Notification.permission!=='granted')permission=await Notification.requestPermission();else permission='granted';
      if(permission!=='granted'){error='Разрешите уведомления для Automesh в настройках браузера.';return;}
      await onEnable(provider);message='Уведомления подключены на этом устройстве.';
    } catch(e){error=errors[e instanceof Error?e.message:'']??'Не удалось подключить уведомления. Доставка сообщений продолжает работать.';}
    finally{busy=false;}
  }
  async function disable(){busy=true;message='';error='';try{await onDisable();message='Уведомления отключены для этого профиля.';}catch{error='Не удалось отключить уведомления на сервере. Проверьте интернет и повторите.';}finally{busy=false;}}
  async function test(){busy=true;message='';error='';try{await onTest();message='Проверка отправлена. Проверьте системное уведомление.';}catch(e){error=errors[e instanceof Error?e.message:'']??'Проверка не отправлена. Проверьте интернет и настройки браузера.';}finally{busy=false;}}
</script>
<section class="settings-section notification-settings">
  <h4>{$i18n.text('Уведомления')}</h4>
  <p class="muted">{$i18n.text('О новых сообщениях, даже когда Automesh закрыт. Без текста сообщений и имён.')}</p>
  {#if !available}<p>{$i18n.text('Откройте сетевой профиль в доверенном режиме, чтобы настроить уведомления.')}</p>
  {:else if !supported}<p>{$i18n.text('Браузер не поддерживает Web Push. На iPhone и iPad добавьте Automesh на главный экран и откройте оттуда.')}</p>
  {:else}
    <p role="status">{$i18n.text(configuration.enabled ? status==='notification_unavailable'?'Служба уведомлений временно недоступна.':status==='notification_reconnect'?'Переподключите уведомления на этом устройстве.':'Уведомления включены для этого профиля.':'Уведомления выключены.')}</p>
    <div class="actions">
      {#if !configuration.enabled || status==='notification_reconnect'}<button type="button" disabled={busy} onclick={()=>void enable(configuration.provider||defaultProvider)}>{$i18n.text('Включить уведомления')}</button>
      {:else}<button type="button" disabled={busy} onclick={()=>void test()}>{$i18n.text('Проверить уведомление')}</button><button type="button" disabled={busy} onclick={()=>void disable()}>{$i18n.text('Выключить уведомления')}</button>{/if}
    </div>
    {#if permission==='denied'}<p>{$i18n.text('Разрешите уведомления для Automesh в настройках браузера.')}</p>{/if}
    <details bind:open={advanced}><summary>{$i18n.text('Дополнительные настройки')}</summary>
      <p>{$i18n.text('Провайдер уведомлений:')} {configuration.provider||defaultProvider}</p>
      <label>{$i18n.text('Другой провайдер Automesh')}<input type="url" bind:value={custom} placeholder="https://your-server.org/api/notifications" autocomplete="off" /></label>
      <div class="actions"><button type="button" disabled={busy||!custom.trim()} onclick={()=>void enable(custom.trim())}>{$i18n.text('Подключить провайдера')}</button>
      {#if configuration.provider}<button type="button" disabled={busy} onclick={()=>void enable(defaultProvider)}>{$i18n.text('Вернуть встроенного провайдера')}</button>{/if}</div>
      <p class="muted">{$i18n.text('Brave: включите Use Google services for push messaging. В Brave и Vivaldi также разрешите уведомления сайта и браузера в системе.')}</p>
      <p class="muted">{$i18n.text('При полностью закрытом браузере получение зависит от системы. Уведомление не подтверждает доставку сообщения.')}</p>
      <p class="muted">{$i18n.text('Без ноды отправитель может получить напоминание вернуться, когда собеседник откроет приложение. При подключённой ноде это напоминание не отправляется.')}</p>
      <p class="muted">{$i18n.text('Провайдер видит технические сведения об обращениях, но не получает ключи чатов. Доставка использует push-службу браузера или системы.')}</p>
    </details>
  {/if}
  {#if message}<p role="status">{$i18n.text(message)}</p>{/if}
  {#if error}<p role="alert" class="error">{$i18n.text(error)}</p>{/if}
</section>
<style>.muted{color:var(--muted);font-size:13px}.actions{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}label{display:block}input{display:block;width:100%;box-sizing:border-box;margin-top:6px}.error{color:var(--danger)}details{margin-top:14px}summary{cursor:pointer}p{overflow-wrap:anywhere}</style>
