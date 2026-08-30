import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: {
    activeRuns: [] as unknown[],
    flows: [] as unknown[],
    nodes: [] as unknown[],
    inserted: [] as { table: string; row: Record<string, unknown> }[],
    insertedRun: null as Record<string, unknown> | null,
  },
}));

vi.mock('./admin-client', () => {
  function rows(table: string): unknown[] {
    if (table === 'flow_runs') return h.state.activeRuns;
    if (table === 'flows') return h.state.flows;
    if (table === 'flow_nodes') return h.state.nodes;
    return [];
  }
  function builder(table: string) {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      in: () => b,
      filter: () => b,
      order: () => b,
      limit: () => b,
      update: () => b,
      insert: (row: Record<string, unknown>) => {
        h.state.inserted.push({ table, row });
        if (table === 'flow_runs') h.state.insertedRun = { id: 'run-1', vars: {}, reprompt_count: 0, ...row };
        return b;
      },
      maybeSingle: async () => ({ data: table === 'flow_runs' ? h.state.insertedRun : (rows(table)[0] ?? null), error: null }),
      single: async () => ({ data: rows(table)[0] ?? null, error: null }),
      then: (resolve: (r: { data: unknown[]; error: null; count: number }) => unknown) => resolve({ data: rows(table), error: null, count: 0 }),
    };
    return b;
  }
  return {
    supabaseAdmin: () => ({
      from: (t: string) => builder(t),
      rpc: vi.fn(async () => ({ error: null })),
    }),
  };
});

const dispatchText = vi.fn(async () => ({ providerMessageId: 'wamid.1', messageId: 'msg-1' }));
vi.mock('./meta-send', () => ({
  engineSendText: vi.fn(async () => ({ whatsapp_message_id: 'wamid.1' })),
  engineSendMedia: vi.fn(async () => ({ whatsapp_message_id: 'wamid.2' })),
  engineSendInteractiveButtons: vi.fn(async () => ({ whatsapp_message_id: 'wamid.3' })),
  engineSendInteractiveList: vi.fn(async () => ({ whatsapp_message_id: 'wamid.4' })),
}));
vi.mock('@/lib/channels/socket', () => ({
  dispatchText: (...a: unknown[]) => (dispatchText as unknown as (...x: unknown[]) => unknown)(...a),
  dispatchMedia: vi.fn(async () => ({ providerMessageId: 'tg_1_1', messageId: 'msg-2' })),
  dispatchInteractive: vi.fn(async () => ({ providerMessageId: 'tg_1_2', messageId: 'msg-3' })),
  resolveChannelTarget: (raw: string | null | undefined, trigger: string | null | undefined) => {
    if (raw == null) return 'whatsapp';
    if (raw === 'current') return trigger ?? null;
    if (raw === 'whatsapp' || raw === 'telegram') return raw;
    return null;
  },
}));

import { dispatchInboundToFlows } from './engine';
import type { ParsedInbound } from './types';

function makeNodesForFlow(flowId: string, nodeType: string, buttons?: { reply_id: string; title: string; next_node_key: string }[]) {
  if (nodeType === 'send_buttons') {
    return [
      { id: 'n1', flow_id: flowId, node_key: 'start', node_type: 'start', config: { next_node_key: 'prompt' } },
      { id: 'n2', flow_id: flowId, node_key: 'prompt', node_type: 'send_buttons', config: { text: 'Pick', buttons: buttons ?? [{ reply_id: 'yes', title: 'Yes', next_node_key: 'end' }] } },
      { id: 'n3', flow_id: flowId, node_key: 'end', node_type: 'end', config: {} },
    ];
  }
  return [
    { id: 'n1', flow_id: flowId, node_key: 'start', node_type: 'start', config: { next_node_key: 'prompt' } },
    { id: 'n2', flow_id: flowId, node_key: 'prompt', node_type: 'collect_input', config: { prompt_text: 'Name?', var_key: 'name', next_node_key: 'end' } },
    { id: 'n3', flow_id: flowId, node_key: 'end', node_type: 'end', config: {} },
  ];
}

function baseFlow(id: string) {
  return {
    id,
    account_id: 'acct-1',
    user_id: 'u-1',
    status: 'active',
    trigger_type: 'keyword',
    trigger_config: { keywords: ['hi'], channel: 'any' },
    entry_node_id: 'start',
    created_at: '2026-01-01T00:00:00Z',
  };
}

beforeEach(() => {
  h.state.activeRuns = [];
  h.state.flows = [];
  h.state.nodes = [];
  h.state.inserted = [];
  h.state.insertedRun = null;
  dispatchText.mockClear();
});

describe('channel isolation', () => {
  it('Telegram suspended Flow not resumed by WhatsApp inbound', async () => {
    // Active Telegram flow waiting on send_buttons
    h.state.activeRuns = [
      { id: 'run-tg', account_id: 'acct-1', contact_id: 'ct-1', flow_id: 'flow-1', status: 'active', current_node_key: 'prompt', trigger_channel: 'telegram', vars: {}, reprompt_count: 0, conversation_id: 'cv-1', started_at: '2026-01-01T00:00:00Z' },
    ];
    h.state.flows = [baseFlow('flow-1')];
    h.state.nodes = makeNodesForFlow('flow-1', 'send_buttons', [{ reply_id: 'yes', title: 'Yes', next_node_key: 'end' }]);

    const res = await dispatchInboundToFlows({
      accountId: 'acct-1',
      userId: 'u-1',
      contactId: 'ct-1',
      conversationId: 'cv-1',
      channel: 'whatsapp',
      message: { kind: 'interactive_reply', reply_id: 'yes', reply_title: 'Yes', meta_message_id: 'm1' } as ParsedInbound,
      isFirstInboundMessage: false,
    });
    // Should NOT resume Telegram run — falls through to no_match (no new flow with that reply_id beyond trigger)
    // Since no entry flow matches whatsapp yes? Actually keyword flow would match, but we have no whatsapp active run matching, so it should try findEntryFlow. Our flows[0] keyword hi not yes, so no_match.
    expect(res.consumed).toBe(false);
  });

  it('WhatsApp suspended not resumed by Telegram', async () => {
    h.state.activeRuns = [
      { id: 'run-wa', account_id: 'acct-1', contact_id: 'ct-1', flow_id: 'flow-1', status: 'active', current_node_key: 'prompt', trigger_channel: 'whatsapp', vars: {}, reprompt_count: 0, conversation_id: 'cv-1', started_at: '2026-01-01T00:00:00Z' },
    ];
    h.state.flows = [baseFlow('flow-1')];
    h.state.nodes = makeNodesForFlow('flow-1', 'send_buttons', [{ reply_id: 'yes', title: 'Yes', next_node_key: 'end' }]);

    const res = await dispatchInboundToFlows({
      accountId: 'acct-1',
      userId: 'u-1',
      contactId: 'ct-1',
      conversationId: 'cv-1',
      channel: 'telegram',
      message: { kind: 'interactive_reply', reply_id: 'yes', reply_title: 'Yes', meta_message_id: 'm2' } as ParsedInbound,
      isFirstInboundMessage: false,
    });
    expect(res.consumed).toBe(false);
  });
});

describe('correct matching', () => {
  it('Telegram callback resumes correct Telegram Flow', async () => {
    h.state.activeRuns = [
      { id: 'run-tg', account_id: 'acct-1', contact_id: 'ct-1', flow_id: 'flow-1', status: 'active', current_node_key: 'prompt', trigger_channel: 'telegram', vars: {}, reprompt_count: 0, conversation_id: 'cv-1', started_at: '2026-01-01T00:00:00Z' },
    ];
    h.state.flows = [baseFlow('flow-1')];
    h.state.nodes = makeNodesForFlow('flow-1', 'send_buttons', [{ reply_id: 'yes', title: 'Yes', next_node_key: 'end' }]);

    const res = await dispatchInboundToFlows({
      accountId: 'acct-1',
      userId: 'u-1',
      contactId: 'ct-1',
      conversationId: 'cv-1',
      channel: 'telegram',
      message: { kind: 'interactive_reply', reply_id: 'yes', reply_title: 'Yes', meta_message_id: 'm3' } as ParsedInbound,
      isFirstInboundMessage: false,
    });
    expect(res.consumed).toBe(true);
    expect(res.flow_run_id).toBe('run-tg');
  });
});

describe('multiple runs', () => {
  it('Flow A and Flow B can both wait for same contact', async () => {
    h.state.activeRuns = [
      { id: 'run-a', account_id: 'acct-1', contact_id: 'ct-1', flow_id: 'flow-a', status: 'active', current_node_key: 'prompt-a', trigger_channel: 'telegram', vars: {}, reprompt_count: 0, conversation_id: 'cv-1', started_at: '2026-01-01T00:00:00Z' },
      { id: 'run-b', account_id: 'acct-1', contact_id: 'ct-1', flow_id: 'flow-b', status: 'active', current_node_key: 'prompt-b', trigger_channel: 'whatsapp', vars: {}, reprompt_count: 0, conversation_id: 'cv-1', started_at: '2026-01-01T00:01:00Z' },
    ];
    h.state.flows = [baseFlow('flow-a'), baseFlow('flow-b')];
    h.state.nodes = [
      { id: 'n1', flow_id: 'flow-a', node_key: 'start', node_type: 'start', config: { next_node_key: 'prompt-a' } },
      { id: 'n2', flow_id: 'flow-a', node_key: 'prompt-a', node_type: 'send_buttons', config: { text: 'Pick', buttons: [{ reply_id: 'yes', title: 'Yes', next_node_key: 'end-a' }] } },
      { id: 'n3', flow_id: 'flow-a', node_key: 'end-a', node_type: 'end', config: {} },
      { id: 'n4', flow_id: 'flow-b', node_key: 'start', node_type: 'start', config: { next_node_key: 'prompt-b' } },
      { id: 'n5', flow_id: 'flow-b', node_key: 'prompt-b', node_type: 'send_buttons', config: { text: 'Pick', buttons: [{ reply_id: 'no', title: 'No', next_node_key: 'end-b' }] } },
      { id: 'n6', flow_id: 'flow-b', node_key: 'end-b', node_type: 'end', config: {} },
    ];

    // Telegram yes should resume only flow-a
    const res = await dispatchInboundToFlows({
      accountId: 'acct-1',
      userId: 'u-1',
      contactId: 'ct-1',
      conversationId: 'cv-1',
      channel: 'telegram',
      message: { kind: 'interactive_reply', reply_id: 'yes', reply_title: 'Yes', meta_message_id: 'm4' } as ParsedInbound,
      isFirstInboundMessage: false,
    });
    expect(res.consumed).toBe(true);
    expect(res.flow_run_id).toBe('run-a');
  });
});
