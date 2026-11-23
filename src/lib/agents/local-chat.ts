import { MESSAGE_ID } from '$lib/chat/message-details';

export type AgentTurn = { role: 'user' | 'assistant'; content: string };
export type LocalAgentMessage = AgentTurn & { id: string; timestamp: number };

export const MAX_LOCAL_AGENT_MESSAGES = 1000;
export const MAX_LOCAL_AGENT_PROMPT = 4000;
const CONTEXT_BUDGET = 3200;

export function normalizeLocalAgentHistory(value: unknown): LocalAgentMessage[] {
  if (!Array.isArray(value)) return [];
  const history: LocalAgentMessage[] = [];
  const ids = new Set<string>();
  for (const message of value.slice(-MAX_LOCAL_AGENT_MESSAGES)) {
    if (!message || typeof message !== 'object') continue;
    const { id, role, content, timestamp } = message;
    if (typeof id !== 'string' || !MESSAGE_ID.test(id) || ids.has(id) ||
      (role !== 'user' && role !== 'assistant') || typeof content !== 'string' || !content.trim() ||
      !Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8.64e15) continue;
    ids.add(id);
    history.push({ id, role, content: content.slice(0, MAX_LOCAL_AGENT_PROMPT), timestamp });
  }
  return history;
}

// Include recent question/answer pairs, skipping earlier unanswered prompts
// so chat templates that require alternating roles can still render.
export function recentAgentTurns(history: readonly LocalAgentMessage[], prompt: string): AgentTurn[] {
  let budget = CONTEXT_BUDGET - prompt.length;
  let answer: LocalAgentMessage | undefined;
  const turns: AgentTurn[] = [];
  for (let index = history.length - 1; index >= 0 && turns.length < 8 && budget > 0; index--) {
    const message = history[index];
    if (message.role === 'assistant') { answer = message; continue; }
    if (!answer) continue;
    budget -= message.content.length + answer.content.length + 32;
    if (budget < 0) break;
    turns.unshift({ role: 'user', content: message.content }, { role: 'assistant', content: answer.content });
    answer = undefined;
  }
  return turns;
}
