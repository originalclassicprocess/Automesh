import {it,expect} from 'vitest';import {render} from 'svelte/server';import QueueIndicator from './QueueIndicator.svelte';import {queueIndicatorStates} from './queue-indicator';
it('uses one compact cloud, omits storage and preserves all states for rotation',()=>{
 const p={stopped:1,errors:2,canceling:0,stored:3,transmitting:4};const states=queueIndicatorStates(p);expect(states.map(s=>[s.count,s.tone])).toEqual([[2,'danger'],[4,'warning'],[3,'success'],[1,'muted']]);
 const html=render(QueueIndicator,{props:{...p,onOpen:()=>{}}}).body;expect(html.match(/<button/g)).toHaveLength(1);expect(html).not.toContain('МБ');expect(html).not.toContain('↑');expect(html).toContain('Очередь сообщений');
});
it('keeps an empty queue gray and bounds the badge text without losing the accessible count',()=>{
 expect(queueIndicatorStates({stopped:0,errors:0,canceling:0,stored:0,transmitting:0})).toMatchObject([{count:0,tone:'muted'}]);
 const html=render(QueueIndicator,{props:{stopped:0,errors:0,canceling:0,stored:1234,transmitting:0,onOpen:()=>{}}}).body;expect(html).toContain('99+');expect(html).toContain('1234');
});
it('shows an unknown node count as a question mark, with no false empty or zero label',()=>{
 const props={stopped:0,errors:0,canceling:0,stored:0,transmitting:0,unknown:true,onOpen:()=>{}};
 expect(queueIndicatorStates(props)).toMatchObject([{kind:'unknown',tone:'muted'}]);
 const html=render(QueueIndicator,{props}).body;
 expect(html).toContain('?');expect(html).not.toContain('Очередь пуста');expect(html).not.toContain(': 0');
 expect(queueIndicatorStates({...props,stored:2,errors:1}).map(s=>s.kind)).toEqual(['errors','unknown','stored']);
});

it('separates user cancellation, automatic expiry, canceling, attention and live transfer colors',()=>{
 const states=queueIndicatorStates({stopped:1,expired:2,canceling:3,errors:4,stored:5,transmitting:6,retrying:7});
 expect(Object.fromEntries(states.map(s=>[s.kind,s.tone]))).toEqual({stopped:'muted',expired:'danger',canceling:'warning',errors:'danger',stored:'success',transmitting:'warning',retrying:'warning'});
});
it('keeps pending upload ahead of stored copies instead of alternating into a false green summary',()=>{
 const props={stopped:0,errors:0,canceling:0,stored:10,transmitting:1,onOpen:()=>{}};
 expect(queueIndicatorStates(props)[0]).toMatchObject({kind:'transmitting',tone:'warning'});
 const html=render(QueueIndicator,{props}).body;expect(html).toMatch(/class="queue-indicator[^\"]*\bwarning\b/);
 expect(queueIndicatorStates({...props,transmitting:0})[0]).toMatchObject({kind:'stored',tone:'success'});
});
