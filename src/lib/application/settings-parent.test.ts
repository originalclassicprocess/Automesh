import {expect,it,vi} from 'vitest';
import {settingsParent,sameSettingsLocation} from './settings-parent';
import {PageNavigation,type HistoryPort} from './page-navigation';
import {navigationLevel,type NavigationView} from './navigation-level';
const chat:NavigationView={screen:'account',view:'chats',pane:'chat',peer:'private-peer',card:'',settings:'overview',layer:'',gallery:''};
it('defines a bounded parent path for every network and media subsection',()=>{
  let route={...chat,view:'profile',settings:'connection',connection:'outgoing'};
  for(const connection of ['nodes','overview']){route=settingsParent(route)!;expect(route.connection).toBe(connection);}
  expect(settingsParent(route)?.settings).toBe('overview');
  expect(settingsParent({...chat,view:'profile'})).toBeNull();
  expect(settingsParent({...chat,view:'profile',settings:'files',media:'storage'})?.media).toBe('overview');
});
it('returns to real parents after repeatedly switching sections, without replaying siblings or reviving them through Forward',()=>{
  const entries:unknown[]=[{}];let at=0;const restore=vi.fn();
  const history:HistoryPort={get state(){return entries[at];},pushState(s){entries.splice(++at);entries.push(s);},replaceState(s){entries[at]=s;},back(){nav.pop(entries[--at]);},go(delta){at+=delta;nav.pop(entries[at]);}};
  const nav=new PageNavigation(history,restore,()=>{},()=> 'test',navigationLevel);
  nav.start(chat);const menu={...chat,view:'profile'};nav.visit(menu);
  nav.visit({...menu,settings:'connection',connection:'overview'});
  nav.visit({...menu,settings:'connection',connection:'nodes'});
  nav.visit({...menu,settings:'connection',connection:'outgoing'});
  nav.visit({...menu,settings:'security'});nav.visit({...menu,settings:'files',media:'storage'});
  const stale=history.state;
  const parent={...menu,settings:'files',media:'overview'};
  nav.backTo(r=>sameSettingsLocation(r,parent),parent);expect(restore).toHaveBeenLastCalledWith(parent);
  nav.backTo(r=>sameSettingsLocation(r,menu),menu);expect(restore).toHaveBeenLastCalledWith(menu);
  nav.pop(stale);expect(restore).toHaveBeenLastCalledWith(menu);
  nav.backTo(r=>r.view==='chats',chat);expect(restore).toHaveBeenLastCalledWith(chat);
  expect(JSON.stringify(entries)).not.toContain('private-peer');
});
