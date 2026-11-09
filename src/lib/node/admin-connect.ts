import { homeNodeUrl, signedNodeRequest, requireNodeNetwork } from './client';
import { isLocalHost } from '$lib/transport/client-config';
import type { IdentityProvider } from '$lib/identity/identity';
export type AdminConnect = { url: string; nodeId: string; ticket: string; expiresAt: number };
export function parseAdminConnect(page: string, now = Date.now()): AdminConnect | null {
  const query = new URL(page).searchParams;
  if (!query.has('nodeAdmin')) return null;
  for (const key of ['nodeAdmin', 'nodeId', 'ticket', 'expiresAt']) if (query.getAll(key).length !== 1) throw new Error('invalid_admin_connect');
  const url = homeNodeUrl(query.get('nodeAdmin')!);
  const nodeId = query.get('nodeId')!, ticket = query.get('ticket')!, expiresAt = Number(query.get('expiresAt'));
  if (isLocalHost(new URL(url).hostname) || !/^[a-f0-9]{32}$/.test(nodeId) || !/^[a-f0-9]{32}$/.test(ticket) ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + 120000) throw new Error('invalid_admin_connect');
  return { url, nodeId, ticket, expiresAt };
}
// Called only from the explicit confirmation button. A URL never signs by itself.
export async function approveAdminConnect(request: AdminConnect, address: string, signer: () => IdentityProvider | null,
  code: string, signal: AbortSignal, lanOnly = false): Promise<void> {
  requireNodeNetwork(request.url, lanOnly);
  const identity = signer();
  const current = () => { if (signal.aborted || signer() !== identity || !identity || request.expiresAt <= Date.now()) throw new Error('admin_connect_cancelled'); };
  current();
  const guarded: IdentityProvider = { create: async () => { throw new Error('unsupported'); }, fromSeed: async () => { throw new Error('unsupported'); },
    verify: async () => false,
    getPublicKeyBytes: async () => { current(); const bytes = await identity!.getPublicKeyBytes(); current(); return bytes; },
    sign: async bytes => { current(); const result = await identity!.sign(bytes); current(); return result; } };
  await signedNodeRequest(request.url, request.nodeId, guarded, address, '/admin/connect/approve',
    { publicUrl: request.url, ticket: request.ticket, scope: 'node-admin-v1', code: code.trim().toLowerCase() }, signal);
  current();
}
