import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Avatar from './Avatar.svelte';
import ContactCard from './ContactCard.svelte';
import ProfileIdentity from '$lib/profiles/ProfileIdentity.svelte';
import { avatarFixture } from './avatar.fixture';
import { identiconFor } from '$lib/addressing/identicon';
import { encodeAccountId } from '$lib/addressing/bech32m.js';
const accountId = encodeAccountId(new Uint8Array(20).fill(1));
const props = { accountId, nickname:'Alice', alias:'', qr:'', copied:false, blocked:false, hasChat:true, messages:[], urls:{}, errors:{},
  copy:()=>{}, rename:()=>false, toggleBlock:()=>{}, openChat:()=>{}, openMessage:()=>{}, preview:()=>({destroy:()=>{}}), canOpen:()=>false, share:()=>{} };
describe('photo avatar UI',()=> {
  it('uses identicons by default and photo avatars across the common component and profile header',()=> {
    expect(render(Avatar,{props:{accountId}}).body).toContain(identiconFor(accountId));
    expect(render(Avatar,{props:{accountId,photo:avatarFixture()}}).body).toContain(avatarFixture());
    const header = render(ProfileIdentity,{props:{accountId,avatar:avatarFixture(),photo:true,nickname:'Alice',profile:'Личный',onOpen:()=>{}}}).body;
    expect(header).toContain(avatarFixture()); expect(header).toContain('Alice');
  });
  it('keeps the address identicon next to the ID when a photo is present and editing in own card only',()=> {
    const own = render(ContactCard,{props:{...props,self:true,photo:avatarFixture(),changePhoto:()=>{}}}).body;
    expect(own).toContain('Заменить фото'); expect(own).toContain('Убрать фото');
    expect(own).toMatch(/address-line[^]*Пиксельный узор адреса[^]*<code[^]*mesh1/);
    const peer = render(ContactCard,{props:{...props,photo:avatarFixture()}}).body;
    expect(peer).toContain('Пиксельный узор адреса'); expect(peer).not.toContain('Заменить фото');
    const original = render(ContactCard,{props}).body; expect(original).not.toContain('Пиксельный узор адреса');
  });
});
