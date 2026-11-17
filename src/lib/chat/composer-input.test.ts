import { afterEach, describe, expect, it, vi } from 'vitest';
import { ComposerInput, keyboardGap } from './composer-input';

function fixture(mobile = true) {
  const calls: string[] = [], attrs = new Map<string, string>(), data = new Set<string>();
  const listeners = new Map<string, (e: any) => void>();
  const viewport = new EventTarget() as EventTarget & {height:number;offsetTop:number;scale:number};
  Object.assign(viewport, {height:800,offsetTop:0,scale:1});
  const doc = {activeElement:null as unknown};
  const field = {disabled:false,selectionStart:2,selectionEnd:4,
    getAttribute:(name:string)=>attrs.get(name)??null,
    setAttribute:(name:string,value:string)=>{attrs.set(name,value);calls.push('mode:'+value);},
    removeAttribute:(name:string)=>{attrs.delete(name);calls.push('mode:default');},
    blur:()=>{doc.activeElement=null;calls.push('blur');},
    focus:()=>{doc.activeElement=field;calls.push('focus');listeners.get('focusin')?.({target:field});},
    setSelectionRange:(start:number,end:number)=>{field.selectionStart=start;field.selectionEnd=end;},
  };
  const node = {querySelector:()=>field,style:{setProperty:vi.fn()},
    toggleAttribute:(name:string,value:boolean)=>value?data.add(name):data.delete(name),
    addEventListener:(name:string,fn:(e:any)=>void)=>listeners.set(name,fn),
    removeEventListener:(name:string)=>listeners.delete(name),
  };
  const win = {innerHeight:800,innerWidth:390,visualViewport:viewport,matchMedia:()=>({matches:mobile}),addEventListener:vi.fn(),removeEventListener:vi.fn()};
  vi.stubGlobal('window',win);vi.stubGlobal('document',doc);
  let open=false;
  const input=new ComposerInput(()=>open,value=>{open=value;calls.push('open:'+value);});
  const action=input.mount(node as unknown as HTMLElement,false);
  return {input,action,field,doc,node,viewport,win,calls,attrs,data,listeners,open:()=>open};
}
afterEach(()=>vi.unstubAllGlobals());
describe('mutually exclusive phone composer inputs',()=>{
  it('blurs the keyboard and waits for its viewport to recover before showing the picker',()=>{
    const f=fixture();f.field.focus();f.viewport.height=500;f.viewport.dispatchEvent(new Event('resize'));
    f.calls.length=0;f.input.toggle();
    expect(f.open()).toBe(true);expect(f.attrs.get('inputmode')).toBe('none');expect(f.doc.activeElement).toBeNull();
    expect(f.data.has('data-keyboard-hiding')).toBe(true);
    expect(f.node.style.setProperty).toHaveBeenCalledWith('--composer-panel-height','300px');
    f.viewport.height=800;f.viewport.dispatchEvent(new Event('resize'));
    expect(f.data.has('data-keyboard-hiding')).toBe(false);
    f.calls.length=0;f.input.restoreCaret(6,6);
    expect(f.calls).not.toContain('focus');expect(f.open()).toBe(true);expect(f.field.selectionStart).toBe(6);
    f.action.destroy();
  });
  it('returns to the keyboard synchronously and preserves the caret',()=>{
    const f=fixture();f.input.toggle();f.input.restoreCaret(7,7);f.calls.length=0;f.input.toggle();
    expect(f.open()).toBe(false);expect(f.doc.activeElement).toBe(f.field);expect(f.attrs.has('inputmode')).toBe(false);
    expect(f.field.selectionStart).toBe(7);expect(f.data.has('data-panel-open')).toBe(false);
    expect(f.calls.indexOf('mode:default')).toBeLessThan(f.calls.indexOf('focus'));f.action.destroy();
  });
  it('tapping the text field replaces the picker with the keyboard',()=>{
    const f=fixture();f.input.toggle();f.field.focus();
    expect(f.open()).toBe(false);expect(f.attrs.has('inputmode')).toBe(false);f.action.destroy();
  });
  it('does not interpret rotation or pinch zoom as a keyboard',()=>{
    expect(keyboardGap(800,500,0,2)).toBe(0);expect(keyboardGap(800,500,30,1)).toBe(270);
    const f=fixture();f.win.innerHeight=390;f.win.innerWidth=800;f.viewport.height=390;
    f.input.toggle();expect(f.data.has('data-keyboard-hiding')).toBe(false);f.action.destroy();
  });
  it('does not hide an open picker when the window height changes without keyboard focus',()=>{
    const f=fixture();f.input.toggle();f.viewport.height=500;f.win.innerHeight=500;f.viewport.dispatchEvent(new Event('resize'));
    expect(f.open()).toBe(true);expect(f.data.has('data-keyboard-hiding')).toBe(false);f.action.destroy();
  });
  it('keeps desktop focus behavior and removes its listeners on unmount',()=>{
    const f=fixture(false);f.field.focus();f.calls.length=0;f.input.toggle();
    expect(f.calls).not.toContain('blur');expect(f.attrs.has('inputmode')).toBe(false);
    f.input.restoreCaret(3,3);expect(f.calls).toContain('focus');expect(f.open()).toBe(true);
    f.action.destroy();expect(f.listeners.size).toBe(0);expect(f.win.removeEventListener).toHaveBeenCalled();
  });
});
