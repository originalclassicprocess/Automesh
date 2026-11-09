import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { status, notify, flush } from './runtime.mjs';

const empty = { type: 'object', properties: {}, additionalProperties: false };
const tools = [
  { name: 'get_notification_status', description: 'Read configured public sender/recipient and outbox counts. Does not expose secrets or read conversations.',
    inputSchema: empty, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
  { name: 'notify_task_completed', description: 'Send a task result to the single recipient configured locally by the user. Use a stable eventId per task/turn for retries. A queued result is not confirmed delivery.',
    inputSchema: { type: 'object', properties: {
      eventId: { type: 'string', minLength: 1, maxLength: 256 }, title: { type: 'string', minLength: 1, maxLength: 160 },
      summary: { type: 'string', minLength: 1, maxLength: 12000 }, status: { type: 'string', enum: ['completed', 'failed', 'needs_input', 'finished'] },
      threadId: { type: 'string', pattern: '^[0-9a-fA-F-]{36}$' },
    }, required: ['eventId', 'title', 'summary', 'status'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } },
  { name: 'flush_notifications', description: 'Retry the oldest queued notification to the configured recipient. Does not change destination.',
    inputSchema: empty, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true } },
];
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });
let ready = false;
const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
export async function handle(request) {
  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') throw { code: -32600, message: 'Invalid Request' };
  if (request.method === 'initialize') return {
    protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(request.params?.protocolVersion) ? request.params.protocolVersion : '2025-11-25',
    capabilities: { tools: {} }, serverInfo: { name: 'automesh-notifier', version },
    instructions: 'Send only authorized task results to the configured recipient. Secrets are managed locally. Automatic Stop notifications report finished replies, not independently verified task success.',
  };
  if (request.method === 'notifications/initialized') { ready = true; return; }
  if (request.method === 'ping') return {};
  if (request.method.startsWith('notifications/')) return;
  if (!ready) throw { code: -32000, message: 'Server not initialized' };
  if (request.method === 'tools/list') return { tools };
  if (request.method === 'tools/call') {
    const { name, arguments: args = {} } = request.params ?? {};
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw { code: -32602, message: 'Invalid arguments' };
    try {
      if (name === 'get_notification_status' && !Object.keys(args).length) return result(await status());
      if (name === 'flush_notifications' && !Object.keys(args).length) return result(await flush());
      if (name === 'notify_task_completed') return result(await notify(args));
      throw { code: -32602, message: 'Unknown tool or invalid arguments' };
    } catch (error) {
      if (error.code) throw error;
      return { content: [{ type: 'text', text: JSON.stringify({ error: ['invalid_notification', 'notifier_not_configured',
        'outbox_capacity', 'outbox_destination_changed', 'notifier_busy', 'notifier_stale_lock'].includes(error.message) ? error.message : 'notification_failed' }) }], isError: true };
    }
  }
  throw { code: -32601, message: 'Method not found' };
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
const write = message => process.stdout.write(JSON.stringify(message) + '\n');
let pending = Promise.resolve();
input.on('line', line => {
  // Sequential dispatch keeps browser registrations and protocol lifecycle ordered.
  pending = pending.then(async () => {
    let request;
    try {
      if (line.length > 64 * 1024) throw { code: -32600, message: 'Request too large' };
      try { request = JSON.parse(line); } catch { throw { code: -32700, message: 'Parse error' }; }
      const value = await handle(request);
      if (Object.hasOwn(request, 'id')) write({ jsonrpc: '2.0', id: request.id, result: value });
    } catch (error) {
      if (!request || Object.hasOwn(request, 'id')) write({ jsonrpc: '2.0', id: request?.id ?? null,
        error: { code: Number.isInteger(error.code) ? error.code : -32603, message: error.code ? error.message : 'Internal error' } });
    }
  });
});
// Retries continue while the host keeps this MCP process alive. The on-disk
// queue survives host shutdown; startup and future hooks resume delivery.
const timer = setInterval(() => { if (ready) void flush().catch(() => {}); }, 45000);
timer.unref();
input.on('close', () => { clearInterval(timer); });
