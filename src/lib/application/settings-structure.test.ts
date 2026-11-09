import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { settingsMenu, settingsDescriptions, settingsLocation, connectionMenu, mediaSettingsMenu } from './settings-structure';
import SettingsMenu from './SettingsMenu.svelte';
import SettingsLinks from './SettingsLinks.svelte';
import { navigationLevel } from './navigation-level';
import pageSource from '../../routes/+page.svelte?raw';

describe('organized settings',()=>{
  it('has clear task sections including project information, not duplicate nodes/connect/storage sections',()=>{
    expect(settingsMenu.map(item=>item.id)).toEqual(['account','privacy','security','connection','files','application','about']);
    const html=render(SettingsMenu,{props:{section:'overview',items:settingsMenu,descriptions:settingsDescriptions,onSelect:()=>{}}}).body;
    expect(html.match(/<button/g)).toHaveLength(7); expect(html).toContain('Конфиденциальность'); expect(html).not.toContain('Коннект');
  });
  it('keeps old shortcuts pointed at their function without changing saved network data',()=>{
    expect(settingsLocation('nodes')).toMatchObject({section:'connection',connection:'nodes'});
    expect(settingsLocation('connect')).toMatchObject({section:'connection',connection:'connect'});
    expect(settingsLocation('storage')).toMatchObject({section:'files',media:'storage'});
    expect(settingsLocation('connection','incoming')).toMatchObject({section:'connection',connection:'incoming'});
    expect(settingsLocation('invalid','invalid','invalid')).toEqual({section:'overview',connection:'overview',media:'overview'});
  });
  it('uses concise task links for connection and media, keeping cleanup and library separate',()=>{
    const network=render(SettingsLinks,{props:{items:connectionMenu,label:'Связь и ноды',onSelect:()=>{}}}).body;
    const media=render(SettingsLinks,{props:{items:mediaSettingsMenu,label:'Медиа и хранилище',onSelect:()=>{}}}).body;
    expect(network.match(/<button/g)).toHaveLength(7);expect(network).toContain('Диагностика доставки');expect(network).toContain('LoRa');
    expect(settingsLocation('connection','radio')).toMatchObject({section:'connection',connection:'radio'});
    expect(media.match(/<button/g)).toHaveLength(3);expect(media).toContain('Хранилище');expect(media).toContain('GIF и стикеры');
  });
  it('gives nested task pages a Back level below the section menu',()=>{
    const base={screen:'account',view:'profile',settings:'connection',connection:'overview',layer:'',pane:'chat',peer:'',card:'',gallery:''};
    expect(navigationLevel(base)).not.toBe(navigationLevel({...base,connection:'nodes'}));
    expect(navigationLevel({...base,connection:'nodes'})).not.toBe(navigationLevel({...base,connection:'connect'}));
    expect(navigationLevel({...base,connection:'outgoing'})).toBe(navigationLevel({...base,connection:'incoming'}));
    expect(navigationLevel({...base,settings:'files',media:'overview'})).not.toBe(navigationLevel({...base,settings:'files',media:'storage'}));
  });
  it('does not leave privacy controls or media management duplicated in profile settings',()=>{
    const source=pageSource;
    expect(source.match(/Делиться отметками о прочтении/g)).toHaveLength(1);
    expect(source.match(/Показывать моё имя при пересылке сообщений/g)).toHaveLength(1);
    expect(source).toContain('mode="manage"');expect(source).toContain('mode="backup"');
    expect(source).not.toContain("settingsSection === 'nodes'");expect(source).not.toContain("settingsSection === 'connect'");
    expect(source).not.toContain("settingsSection === 'storage'");
  });
});
