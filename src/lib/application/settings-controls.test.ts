import { describe,it,expect } from 'vitest';
import { render } from 'svelte/server';
import ChoiceMenu from './ChoiceMenu.svelte';
import QrInput from './QrInput.svelte';
import page from '../../routes/+page.svelte?raw';
import direct from '../transport/DirectPairing.svelte?raw';
import node from '../node/HomeNodePanel.svelte?raw';
import admin from '../node/NodeAdminConnect.svelte?raw';
// @ts-expect-error Node-only regression test; the app tsconfig has browser types.
import { readFileSync } from 'node:fs';
const css: string = readFileSync(new URL('./application-ui.css', import.meta.url), 'utf8');
describe('consistent settings controls',()=>{
  it('shows the selected label in a rounded accessible list trigger, without a native square dropdown',()=>{
    const html=render(ChoiceMenu,{props:{value:15,label:'Автоблокировка',options:[{value:15,label:'Через 15 минут'}],onChange:()=>{}}}).body;
    expect(html).toContain('Через 15 минут');expect(html).toContain('aria-haspopup="listbox"');expect(html).toContain('aria-expanded="false"');expect(html).not.toContain('<select');
  });
  it('preserves disabled state on choices and all three QR input paths',()=>{
    expect(render(ChoiceMenu,{props:{value:'a',label:'Choice',options:[],disabled:true,onChange:()=>{}}}).body).toContain('disabled');
    const html=render(QrInput,{props:{value:'',label:'Invite',disabled:true,onScan:()=>{},onImage:()=>{}}}).body;
    expect(html.match(/disabled/g)?.length).toBeGreaterThanOrEqual(3);expect(html).toContain('Сканировать QR');expect(html).toContain('Из изображения');expect(html).toContain('type="file"');expect(html).toContain('autocomplete="off"');
  });
  it('supports long QR exchanges without hiding manual entry behind extra actions',()=>{
    const html=render(QrInput,{props:{value:'',label:'QR',multiline:true,maxlength:16000,onScan:()=>{},onImage:()=>{}}}).body;
    expect(html).toContain('<textarea');expect(html).toContain('maxlength="16000"');expect(html).not.toContain('<details');
    for(const source of [page,direct,node,admin])expect(source).toContain('<QrInput');
    expect(direct).toContain('Копировать код подключения');expect(page).toContain('writeText(nodeQrContent)');
  });
  it('keeps frequent profile actions before technical data and scopes the design away from chats',()=>{
    const profile=page.slice(page.indexOf("{#if settingsSection === 'account'}"));
    expect(profile.indexOf('Открытый ключ профиля')).toBeGreaterThan(-1);
    expect(profile.indexOf('Ник</label>')).toBeLessThan(profile.indexOf('Открытый ключ профиля'));
    expect(profile.indexOf('Мои профили')).toBeLessThan(profile.indexOf('Открытый ключ профиля'));
    expect(css).toContain('summary::-webkit-details-marker');expect(css).toContain('.settings-surface input[type=checkbox]');
  });
});
