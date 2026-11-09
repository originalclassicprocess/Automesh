import { createHash, timingSafeEqual } from 'node:crypto';

// Short-lived opaque rendezvous, NOT a messaging node or an authority that can
// grant access. Only the clients can decrypt packets. No disk or account index.
export function createDevicePairingRelay({ origin, now = Date.now, capacity = 128 } = {}) {
  const sessions = new Map(), buckets = new Map();
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const hash = value => createHash('sha256').update(value).digest();
  const exact = (value, names) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === names.sort().join(',');
  const packet = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,90000}$/.test(value);
  const expire = () => {
    for (const [id, value] of sessions) if (value.expiresAt <= now()) sessions.delete(id);
    for (const [ip, value] of buckets) if (value.until <= now()) buckets.delete(ip);
  };
  const timer = setInterval(expire, 30000); timer.unref?.();
  async function handle(request, response, pathname) {
    if (!pathname.startsWith('/api/device-pair/')) return false;
    const reply = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); response.end(JSON.stringify(value)); };
    if (request.method !== 'POST') { reply(405, { error: 'pair_method' }); return true; }
    if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json' || request.headers['content-encoding']) { reply(403, { error: 'pair_origin' }); return true; }
    expire();
    const ip = request.socket.remoteAddress ?? 'unknown'; // Never trust forwarded IPs.
    let budget = buckets.get(ip);
    if (!budget) { if (buckets.size >= 1024) { reply(429, { error: 'pair_rate' }); return true; } budget = { until: now() + 60000, operations: 0, creates: 0 }; buckets.set(ip, budget); }
    if (++budget.operations > 600) { reply(429, { error: 'pair_rate' }); return true; }
    let bytes = 0, chunks = [], input;
    try {
      for await (const chunk of request) { bytes += chunk.length; if (bytes > 91000) { reply(413, { error: 'pair_limit' }); return true; } chunks.push(chunk); }
      input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { if (!response.writableEnded) reply(400, { error: 'pair_input' }); return true; }
    if (pathname === '/api/device-pair/create') {
      if (!exact(input, ['id', 'ownerToken', 'joinToken']) || !hex(input.id) || !hex(input.ownerToken) || !hex(input.joinToken) || input.ownerToken === input.joinToken) { reply(400, { error: 'pair_input' }); return true; }
      if (++budget.creates > 12 || sessions.size >= capacity) { reply(429, { error: 'pair_capacity' }); return true; }
      const prior = sessions.get(input.id);
      if (prior) { reply(409, { error: 'pair_conflict' }); return true; }
      const expiresAt = now() + 600000;
      sessions.set(input.id, { owner: hash(input.ownerToken), join: hash(input.joinToken), expiresAt, request: null, approval: null, complete: null });
      reply(201, { expiresAt }); return true;
    }
    if (!exact(input, ['id', ...(['/api/device-pair/request', '/api/device-pair/complete', '/api/device-pair/approve'].includes(pathname) ? ['packet'] : [])]) || !hex(input.id)) { reply(400, { error: 'pair_input' }); return true; }
    const session = sessions.get(input.id), token = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.authorization ?? '')?.[1];
    const isOwner = ['/api/device-pair/read', '/api/device-pair/cancel', '/api/device-pair/approve'].includes(pathname);
    if (!session || !token || !timingSafeEqual(hash(token), isOwner ? session.owner : session.join)) { reply(404, { error: 'pair_unavailable' }); return true; }
    if (pathname === '/api/device-pair/read') { reply(200, { request: session.request, complete: session.complete, expiresAt: session.expiresAt }); return true; }
    if (pathname === '/api/device-pair/mine') { reply(200, { request: session.request, approval: session.approval }); return true; }
    if (pathname === '/api/device-pair/cancel') { sessions.delete(input.id); reply(200, { cancelled: true }); return true; }
    const field = pathname === '/api/device-pair/request' ? 'request' : pathname === '/api/device-pair/complete' ? 'complete' : pathname === '/api/device-pair/approve' ? 'approval' : null;
    if (!field || !packet(input.packet)) { reply(400, { error: 'pair_input' }); return true; }
    if (field !== 'request' && !session.request) { reply(409, { error: 'pair_order' }); return true; }
    if (session[field] && session[field] !== input.packet) { reply(409, { error: 'pair_claimed' }); return true; }
    session[field] = input.packet; reply(200, { accepted: true }); return true;
  }
  return { handle, close() { clearInterval(timer); sessions.clear(); buckets.clear(); } };
}
