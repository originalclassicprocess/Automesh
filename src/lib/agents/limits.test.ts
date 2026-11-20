import { describe, expect, it } from 'vitest';
import { agentChatPolicy, emptyAgentChatLimits, normalizeAgentChatLimits, radioAgentSender, reserveAgentRequest, senderAgentLimit } from './limits';

const room = 'radio:100:' + 'a'.repeat(64);
const otherRoom = 'radio:100:' + 'b'.repeat(64);
const mesh = 'mesh1qxly480qr4juj5ufeu39xn7dr7uqtzsge50cg56c';
const hour = {count: 1, minutes: 60};
const start = Date.UTC(2026, 0, 1);

describe('chat AI request limits', () => {
  it('counts each radio sender and channel independently and keeps the window after reload', () => {
    const first = reserveAgentRequest(emptyAgentChatLimits(), room, '200', hour, start)!;
    const afterReload = normalizeAgentChatLimits(JSON.parse(JSON.stringify(first)), start + 5_000);
    expect(reserveAgentRequest(afterReload, room, '200', hour, start + 3_599_999)).toBeNull();
    expect(reserveAgentRequest(afterReload, room, '201', hour, start + 5_000)).not.toBeNull();
    expect(reserveAgentRequest(afterReload, otherRoom, '200', hour, start + 5_000)).not.toBeNull();
    expect(reserveAgentRequest(afterReload, room, '200', hour, start + 3_600_000)?.usage[room + '/200']).toEqual({ start: start + 3_600_000, count: 1 });
  });

  it('supports Mesh chat limits and preserves existing caps as an hourly default', () => {
    const empty = emptyAgentChatLimits();
    expect(agentChatPolicy(empty, mesh, 3).limit).toEqual({count: 3, minutes: 60});
    const policy = normalizeAgentChatLimits({ policies: { [mesh]: {limit: {count: 2, minutes: 5}} } });
    expect(agentChatPolicy(policy, mesh, 3).limit).toEqual({count: 2, minutes: 5});
    const first = reserveAgentRequest(policy, mesh, mesh, hour, start)!;
    expect(reserveAgentRequest(normalizeAgentChatLimits(first, start), mesh, mesh, hour, start)).toBeNull();
  });

  it('gives the local board unlimited access by default and allows overrides for individual board IDs', () => {
    const policy = agentChatPolicy(emptyAgentChatLimits(), room);
    expect(senderAgentLimit(policy, '100', true)).toBeNull();
    expect(senderAgentLimit(policy, '200', false)).toEqual(hour);
    const state = normalizeAgentChatLimits({ policies: { [room]: { limit: hour, senders: {
      100: { count: 2, minutes: 10 }, 200: null, '0': null, invalid: null,
    } } } });
    const override = agentChatPolicy(state, room);
    expect(override.senders).toEqual({100: {count: 2, minutes: 10}, 200: null});
    expect(senderAgentLimit(override, '100', true)).toEqual({count: 2, minutes: 10});
    expect(senderAgentLimit(override, '200', false)).toBeNull();
    expect(senderAgentLimit(override, '201', false)).toEqual(hour);
    expect(radioAgentSender('!000000C8')).toBe(radioAgentSender('200'));
    expect(radioAgentSender('!ffffffff')).toBeNull();
  });
});
