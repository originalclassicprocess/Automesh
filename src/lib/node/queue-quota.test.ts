import {it,expect} from 'vitest';
import {render} from 'svelte/server';
import {readQueueSnapshot,freshQueueSnapshot,queueQuotaFull,queueQuotaLabel} from './queue-quota';
import NodeQuotaDetails from './NodeQuotaDetails.svelte';
import {queueIndicatorStates} from '$lib/chat/queue-indicator';
it('distinguishes a full profile from available node capacity and a connected transport',()=>{
  const snapshot=readQueueSnapshot({messages:36,quota:{protocol:'automesh-queue-quota-v1',profileFiles:16,profileFileLimit:16,nodeFiles:16,nodeFileLimit:128,reservedBytes:5*1048576,maxBytes:64*1048576}},1000)!;
  expect(queueQuotaFull(snapshot.quota)).toBe(true);expect(queueQuotaLabel(snapshot.quota)).toBe('Квота файлов профиля заполнена');
  expect(freshQueueSnapshot(snapshot,46001)).toBe(false);
  expect(queueIndicatorStates({stored:6,transmitting:0,stopped:0,errors:0,canceling:0,quota:{count:16,label:queueQuotaLabel(snapshot.quota)}})).toEqual(expect.arrayContaining([expect.objectContaining({kind:'quota',tone:'danger',count:16})]));
  const html=render(NodeQuotaDetails,{props:{snapshot,connected:false}}).body;
  expect(html).toContain('16 / 16');expect(html).not.toContain('16 / 128');expect(html).not.toContain('МБ');expect(html).toContain('данные устарели');expect(html).not.toContain('Квота свободна');
});
it('does not convert unknown or malformed capacity into a free queue',()=>{
  expect(readQueueSnapshot({})).toBeUndefined();
  expect(readQueueSnapshot({messages:6,quota:{protocol:'automesh-queue-quota-v1',profileFiles:-1}})).toEqual(expect.objectContaining({messages:6}));
  expect(readQueueSnapshot({messages:6,quota:{protocol:'automesh-queue-quota-v1',profileFiles:-1}})?.quota).toBeUndefined();
  expect(freshQueueSnapshot(undefined)).toBe(false);
});

it('validates optional message limits independently and never invents missing capacity',()=>{
 const q={protocol:'automesh-queue-quota-v1',profileFiles:2,profileFileLimit:16,nodeFiles:80,nodeFileLimit:128,reservedBytes:99999,maxBytes:67108864,profileMessages:4,profileMessageLimit:100,profileMessageBytes:300,profileMessageByteLimit:4194304,nodeMessages:700,nodeMessageLimit:1000,nodeRecords:900,nodeRecordLimit:2000};
 const snapshot=readQueueSnapshot({messages:4,quota:q})!;
 const html=render(NodeQuotaDetails,{props:{snapshot,kind:'messages'}}).body;
 expect(html).toContain('4 / 100');for(const other of['700','1000','900','2000','МБ'])expect(html).not.toContain(other);
 const invalid=readQueueSnapshot({messages:4,quota:{...q,profileMessageLimit:'100'}})!;
 expect(invalid.quota?.profileFiles).toBe(2);expect(invalid.quota?.profileMessageLimit).toBeUndefined();
 const unknown=render(NodeQuotaDetails,{props:{snapshot:invalid,kind:'messages'}}).body;
 expect(unknown).toContain('Нода не сообщила лимит сообщений');expect(unknown).not.toContain('Нужна обновлённая нода');
});
