import {describe,it,expect} from 'vitest';
import {forwardActivity,recentForwardTargets} from './forward-targets';
describe('forwarding destination order',()=>{
  it('merges normal chats and radio channels by recent conversation, with stable ties and no mutation',()=>{
    const targets=[{id:'old',activity:10},{id:'empty',activity:0},{id:'radio',activity:50},{id:'new',activity:100},{id:'tie',activity:50}];
    expect(recentForwardTargets(targets).map(t=>t.id)).toEqual(['new','radio','tie','old','empty']);
    expect(targets.map(t=>t.id)).toEqual(['old','empty','radio','new','tie']);
  });
  it('does not promote old chats for edit, reaction or pin controls',()=>{
    expect(forwardActivity([{timestamp:20},{timestamp:40,details:{edit:{}}},{timestamp:50,details:{reaction:{}}},{timestamp:60,details:{pin:{}}}])).toBe(20);
    expect(forwardActivity([])).toBe(0);
    expect(forwardActivity([{timestamp:50,details:{reaction:{}}}])).toBe(0);
  });
});
