import { expect, it } from 'vitest';
import { normalizeManagedNodes, nodeCards } from './node-registry';
import { normalizeNetworkSettings, routingEndpoints, networkRoutingChanged } from '$lib/transport/network-settings';
import { render } from 'svelte/server';
import NodesPanel from './NodesPanel.svelte';
import NodeAdminConnect from './NodeAdminConnect.svelte';
import { idleCourierStatus } from './courier-controller';
const node = { url: 'https://node.example', nodeId: 'a'.repeat(32), name: 'Моя нода' };
it('stores only bounded node metadata, never invitation or administrator secrets', () => {
  const input = [{ ...node, code: 'secret', pollToken: 'secret' }, node, { ...node, url: 'https://node.example/?code=secret' }, { ...node, nodeId: 'bad' }];
  expect(normalizeManagedNodes(input)).toEqual([node]);
  const settings = normalizeNetworkSettings({ managedNodes: input });
  expect(JSON.stringify(settings)).not.toContain('secret');
  expect(normalizeNetworkSettings(JSON.parse(JSON.stringify(settings)))).toEqual(settings);
  expect(routingEndpoints([], settings, 'https://automesh.space')).toEqual([]);
  expect(networkRoutingChanged([], normalizeNetworkSettings(null), settings, 'https://automesh.space')).toBe(false);
  expect(networkRoutingChanged([], settings, { ...settings, internetEnabled: false }, 'https://automesh.space')).toBe(true);
  expect(normalizeManagedNodes(Array.from({ length: 20 }, (_, i) => ({ ...node, url: `https://node${i}.example` })))).toHaveLength(12);
});
it('merges roles but detects a changed identity at an existing URL', () => {
  expect(nodeCards([node], node, null)).toEqual([{ ...node, managed: true, outgoing: true, inbox: false, identityConflict: false }]);
  expect(nodeCards([node], { ...node, nodeId: 'b'.repeat(32) }, null)[0].identityConflict).toBe(true);
  expect(nodeCards([], node, null)[0].managed).toBe(false);
});
it('shows a device authority even when it is not an outgoing courier or admin bookmark',()=>{
  expect(nodeCards([],null,null,node)[0]).toMatchObject({directory:true,outgoing:false,managed:false});
  expect(nodeCards([node],null,null,{...node,nodeId:'b'.repeat(32)})[0].identityConflict).toBe(true);
  expect(normalizeManagedNodes([{...node,kind:'home'}])[0].kind).toBe('home');
  expect(nodeCards([{...node,kind:'home'}],null,null)[0].kind).toBe('home');
});
it('shows separate admin and queue roles, without inferring rights from a local bookmark', () => {
  const props = { managed: [node], outgoing: node, inbox: null, enabled: true, status: idleCourierStatus(), pending: 2,
    busy: false, onConnect: () => {}, onOutgoing: () => {}, onIncoming: () => {}, onForget: () => {} };
  const html = render(NodesPanel, { props }).body;
  expect(html).toContain('Подключить ноду'); expect(html).not.toContain('Коннект'); expect(html).toContain('Открыть панель'); expect(html).toContain('Доставка и очередь');
  expect(html).toContain('Права и очередь на ноде сохраняются');
  const conflict = render(NodesPanel, { props: { ...props, outgoing: { ...node, nodeId: 'b'.repeat(32) } } }).body;
  expect(conflict).not.toContain('Открыть панель');
  const connect = render(NodeAdminConnect, { props: { internetEnabled: true, onRequest: () => {} } }).body;
  expect(connect).toContain('Как назначить администратора'); expect(connect).toContain('только для владельца');
  expect(connect).not.toContain('type="password"');
});
