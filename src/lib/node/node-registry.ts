import { homeNodeUrl } from './client';
export type ManagedNode = { url: string; nodeId: string; name: string; kind?: 'home' | 'server' };
export const MAX_MANAGED_NODES = 12;
// This is an encrypted profile's address book, never a grant of admin rights.
export function normalizeManagedNodes(value: unknown): ManagedNode[] {
  const nodes: ManagedNode[] = [];
  if (!Array.isArray(value)) return nodes;
  for (const item of value) {
    if (nodes.length >= MAX_MANAGED_NODES) break;
    try {
      if (!item || typeof item.url !== 'string' || typeof item.nodeId !== 'string' || !/^[a-f0-9]{32}$/.test(item.nodeId)) continue;
      const url = homeNodeUrl(item.url);
      if (nodes.some(node => node.url === url)) continue;
      const name = typeof item.name === 'string' && item.name.trim().length <= 48 && !/[\u0000-\u001f\u007f]/.test(item.name)
        ? item.name.trim() || new URL(url).host : new URL(url).host;
      nodes.push({ url, nodeId: item.nodeId, name, ...(['home','server'].includes(item.kind) ? {kind:item.kind as 'home'|'server'} : {}) });
    } catch { /* Never retain malformed URLs or secrets in an address. */ }
  }
  return nodes;
}
export type NodeCard = ManagedNode & { managed: boolean; outgoing: boolean; inbox: boolean; directory?: boolean; identityConflict: boolean };
export function nodeCards(managed: ManagedNode[], outgoing: { url: string; nodeId: string } | null,
  inbox: { url: string; nodeId: string } | null, directory: {url:string;nodeId:string} | null = null): NodeCard[] {
  const cards = new Map<string, NodeCard>();
  const add = (node: { url: string; nodeId: string; name?: string }, role: 'managed' | 'outgoing' | 'inbox' | 'directory') => {
    const previous = cards.get(node.url);
    if (previous) { previous[role] = true; previous.identityConflict ||= previous.nodeId !== node.nodeId; }
    else cards.set(node.url, { url: node.url, nodeId: node.nodeId, name: node.name ?? new URL(node.url).host, ...('kind' in node ? {kind:node.kind as 'home'|'server'}:{}),
      managed: role === 'managed', outgoing: role === 'outgoing', inbox: role === 'inbox', ...(role === 'directory' ? {directory:true}:{}), identityConflict: false });
  };
  for (const node of managed) add(node, 'managed');
  if (outgoing) add(outgoing, 'outgoing'); if (inbox) add(inbox, 'inbox');
  if (directory) add(directory,'directory');
  return [...cards.values()];
}
