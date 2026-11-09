<script lang="ts">
  import { onDestroy } from 'svelte';
  import { buildInfo } from 'virtual:automesh-build';
  import { tr as i18n } from '$lib/i18n/language';
  import { appRepository,projectLinks,fetchPublicRelease } from './public-releases';
  import HelpInfo from './HelpInfo.svelte';
  let busy=$state(false),message=$state(''),releaseUrl=$state('');
  let controller:AbortController|null=null,alive=true;
  onDestroy(()=>{alive=false;controller?.abort();});
  async function check(){
    if(busy)return;busy=true;message='';controller=new AbortController();const current=controller;
    const timer=setTimeout(()=>current.abort(),10000);
    try{
      const release=await fetchPublicRelease(appRepository,current.signal,fetch,`v${buildInfo.version}`);
      if(!alive)return;releaseUrl=release.url;
      message=buildInfo.commit===release.commit&&!buildInfo.dirty?'Версия и коммит совпадают с публичным релизом.':'Эта сборка отличается от публичного релиза.';
    }catch{if(alive)message='Не удалось сверить релиз GitHub. Офлайн-работа приложения остаётся доступной.';}
    finally{clearTimeout(timer);if(alive)busy=false;}
  }
</script>
<section class="about-project" aria-label={$i18n.text("О проекте")}>
  <h4>Automesh</h4>
  <p>{$i18n.text("Личное общение, хранение на своих устройствах и выбор доступного способа связи.")}</p>
  <dl>
    <div><dt>{$i18n.text("Версия")}</dt><dd>{buildInfo.version}</dd></div>
    <div><dt>{$i18n.text("Сборка")}</dt><dd>{buildInfo.source==='github-actions'?$i18n.text("GitHub Actions"):$i18n.text("Локальная сборка")}</dd></div>
    {#if buildInfo.commit}<div><dt>{$i18n.text("Исходники сборки")}</dt><dd><a href={`${projectLinks.app}/tree/${buildInfo.commit}`} target="_blank" rel="noopener noreferrer"><code>{buildInfo.commit.slice(0,12)}</code></a>{#if buildInfo.dirty}<small>{$i18n.text("Есть локальные изменения")}</small>{/if}</dd></div>{/if}
  </dl>
  <nav aria-label={$i18n.text("Ссылки проекта")}>
    <a href={projectLinks.app} target="_blank" rel="noopener noreferrer">{$i18n.text("Исходники приложения")}</a>
    <a href={projectLinks.nodes} target="_blank" rel="noopener noreferrer">{$i18n.text("Исходники нод")}</a>
    <a href={projectLinks.history} target="_blank" rel="noopener noreferrer">{$i18n.text("История проекта")}</a>
    <a href={projectLinks.issues} target="_blank" rel="noopener noreferrer">{$i18n.text("Сообщить об ошибке")}</a>
    <a href={projectLinks.license} target="_blank" rel="noopener noreferrer">MIT</a>
    {#if buildInfo.website}<a href={buildInfo.website} target="_blank" rel="noopener noreferrer">{$i18n.text("Сайт проекта")}</a>{/if}
  </nav>
  <div class="release-check">
    <button onclick={check} disabled={busy}>{busy?$i18n.text("Проверяем…"):$i18n.text("Сверить с релизом GitHub")}</button>
    <HelpInfo label={$i18n.text("Справка: сверка сборки")} text={$i18n.text("По нажатию GitHub получает обычный запрос к публичному релизу без данных аккаунта. Сравниваются версия и коммит. Это не независимая проверка всех файлов: для неё используйте отдельную проверку опубликованной сборки.")} />
  </div>
  {#if message}<p role="status">{$i18n.text(message)} {#if releaseUrl}<a href={releaseUrl} target="_blank" rel="noopener noreferrer">{$i18n.text("Открыть релиз")}</a>{/if}</p>{/if}
  <details><summary>{$i18n.text("Проверка опубликованной сборки")}</summary>
    <p>{$i18n.text("Независимая проверка сверяет файлы клиента с подтверждённым архивом GitHub. Она не проверяет скрытую серверную часть и не заменяет аудит безопасности.")}</p>
    <a href={`${projectLinks.app}/blob/main/docs/VERIFY_RELEASE.md`} target="_blank" rel="noopener noreferrer">{$i18n.text("Инструкция проверки")}</a>
  </details>
  <small>{$i18n.text("Экспериментальный проект. Независимый аудит безопасности ещё не завершён.")}</small>
</section>
<style>
  .about-project{max-width:760px}h4{margin:.5rem 0;font-size:1.2rem}p{line-height:1.5}
  dl{display:grid;gap:8px}dl>div{display:grid;grid-template-columns:minmax(110px,1fr) minmax(0,2fr);gap:12px;padding:8px 0;border-bottom:1px solid var(--line)}
  dt,small{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}small{display:block;margin-top:12px;line-height:1.5}
  nav{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}nav a{padding:10px 12px;border:1px solid var(--line);border-radius:12px;text-decoration:none;color:inherit}
  .release-check{display:flex;align-items:center;gap:8px;flex-wrap:wrap}details{margin:16px 0}summary{cursor:pointer}
  @media(max-width:420px){dl>div{grid-template-columns:1fr}nav a{flex:1 1 140px;text-align:center}}
</style>
