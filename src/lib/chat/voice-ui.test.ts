import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import VoiceMessage from './VoiceMessage.svelte';
describe('voice composer idle UI',()=> {
  it('uses a named microphone icon rather than a column with long error text',()=> {
    const html=render(VoiceMessage,{props:{onFile:async()=>true,onBusy:()=>{}}}).body;
    expect(html).toContain('Записать голосовое сообщение'); expect(html).toContain('<svg');
    expect(html).not.toContain('voice-strip'); expect(html).not.toContain('Микрофон недоступен'); expect(html).not.toContain('🎙');
  });
});
