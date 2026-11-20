import { isValidAccountId } from '$lib/addressing/bech32m.js';

export type AgentLimit = { count: number; minutes: number };
export type AgentChatPolicy = { limit: AgentLimit | null; senders?: Record<string, AgentLimit | null> };
type Window = { start: number; count: number };
export type AgentChatLimits = { policies: Record<string, AgentChatPolicy>; usage: Record<string, Window> };

export const MAX_AGENT_MINUTES = 7 * 24 * 60;
export const MAX_AGENT_REQUESTS = 1000;
const MAX_WINDOWS = 4096;
export const emptyAgentChatLimits = (): AgentChatLimits => ({ policies: {}, usage: {} });
const radioChat = /^radio:(\d{1,10}):[a-f0-9]{64}$/;
const validNode = (node: number) => Number.isInteger(node) && node > 0 && node < 0xffffffff;

export function radioAgentSender(input: string): string | null {
  const text = input.trim();
  const node = /^![a-f0-9]{1,8}$/i.test(text) ? Number.parseInt(text.slice(1), 16)
    : /^\d{1,10}$/.test(text) ? Number(text) : NaN;
  return validNode(node) ? String(node) : null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function limit(value: unknown): AgentLimit | null | undefined {
  if (value === null) return null;
  const { count, minutes } = object(value);
  if (typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= MAX_AGENT_REQUESTS &&
      typeof minutes === 'number' && Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_AGENT_MINUTES) return { count, minutes };
}

export function normalizeAgentChatLimits(value: unknown, now = Date.now()): AgentChatLimits {
  const stored = object(value), state = emptyAgentChatLimits();
  for (const [chat, entry] of Object.entries(object(stored.policies)).slice(-512)) {
    const native = radioChat.exec(chat), row = object(entry), fallback = limit(row.limit);
    if (fallback === undefined || !(native ? validNode(Number(native[1])) : isValidAccountId(chat))) continue;
    const senders: NonNullable<AgentChatPolicy['senders']> = {};
    if (native) for (const [sender, value] of Object.entries(object(row.senders)).slice(-128)) {
      const policy = limit(value);
      if (radioAgentSender(sender) === sender && policy !== undefined) senders[sender] = policy;
    }
    state.policies[chat] = { limit: fallback, ...(Object.keys(senders).length ? { senders } : {}) };
  }
  for (const [key, value] of Object.entries(object(stored.usage)).slice(-MAX_WINDOWS)) {
    const [chat, sender, extra] = key.split('/');
    const native = radioChat.exec(chat), entry = object(value);
    if (extra !== undefined || !sender || (native ? !validNode(Number(native[1])) || radioAgentSender(sender) !== sender : !isValidAccountId(chat) || chat !== sender)) continue;
    const { start, count } = entry;
    if (typeof start === 'number' && Number.isSafeInteger(start) && start > now - MAX_AGENT_MINUTES * 60_000 && start <= now &&
        typeof count === 'number' && Number.isInteger(count) && count > 0 && count <= MAX_AGENT_REQUESTS) state.usage[key] = { start, count };
  }
  return state;
}

export function agentChatPolicy(state: AgentChatLimits, chat: string, legacyLimit?: number): AgentChatPolicy {
  return state.policies[chat] ?? { limit: radioChat.test(chat) ? { count: 1, minutes: 60 }
    : legacyLimit ? { count: Math.min(legacyLimit, MAX_AGENT_REQUESTS), minutes: 60 } : null };
}

export function senderAgentLimit(policy: AgentChatPolicy, sender: string, own: boolean): AgentLimit | null {
  return Object.hasOwn(policy.senders ?? {}, sender) ? policy.senders![sender] : own ? null : policy.limit;
}

// A window starts with the first accepted request. The caller saves a new
// reservation before starting inference, so reconnecting cannot reset it.
export function reserveAgentRequest(state: AgentChatLimits, chat: string, sender: string,
  limit: AgentLimit | null, now = Date.now()): AgentChatLimits | null {
  if (!limit) return state;
  const key = `${chat}/${sender}`, previous = state.usage[key];
  const window = previous && now < previous.start + limit.minutes * 60_000 ? previous : { start: now, count: 0 };
  if (window.count >= limit.count) return null;
  let usage = state.usage;
  if (Object.keys(usage).length >= MAX_WINDOWS) {
    usage = Object.fromEntries(Object.entries(usage).filter(([, entry]) => now - entry.start < MAX_AGENT_MINUTES * 60_000));
    if (!Object.hasOwn(usage, key) && Object.keys(usage).length >= MAX_WINDOWS) return null;
  }
  return { ...state, usage: { ...usage, [key]: { start: window.start, count: window.count + 1 } } };
}
