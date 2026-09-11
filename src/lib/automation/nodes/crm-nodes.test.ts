import { describe, expect, it, vi } from 'vitest';

import { catalogFromRegistry } from '../catalog';
import { DOMAIN_EVENT } from '../event-types';
import { graphFromNodes } from '../graph';
import { defaultRegistry } from '../registry';
import type { DomainEvent, ExecutionContext } from '../types';
import { validateGraph } from '../validate';
import { assignOwnerAction } from './assign-owner';
import { completeTaskAction, createTaskAction } from './tasks';
import { dealStageChangedTrigger } from './deal-stage-changed';
import { moveDealAction } from './move-deal';
import './index';

// tasks/write.ts emits via crm-events → kick → supabaseAdmin, which
// needs live env. Same precedent as tasks/write.test.ts: observe the
// emit calls without running the worker.
const emitted: Array<{ type: string; args: unknown }> = [];
vi.mock('@/lib/automation/crm-events', () => ({
  emitTaskCreated: vi.fn(async (args: unknown) => {
    emitted.push({ type: 'task_created', args });
  }),
  emitTaskCompleted: vi.fn(async (args: unknown) => {
    emitted.push({ type: 'task_completed', args });
  }),
  emitDealStageChanged: vi.fn(async (args: unknown) => {
    emitted.push({ type: 'deal_stage_changed', args });
  }),
}));

const DEAL = '11111111-1111-1111-1111-111111111111';
const STAGE_A = '22222222-2222-2222-2222-222222222222';
const STAGE_B = '33333333-3333-3333-3333-333333333333';
const PIPE = '44444444-4444-4444-4444-444444444444';
const TASK = '55555555-5555-5555-5555-555555555555';
const PROFILE = '66666666-6666-6666-6666-666666666666';
const USER = '77777777-7777-7777-7777-777777777777';

function event(payload: Record<string, unknown> = {}): DomainEvent {
  return {
    id: 'e1',
    accountId: 'acct-1',
    eventType: DOMAIN_EVENT.DEAL_STAGE_CHANGED,
    contactId: 'contact-1',
    payload,
    source: 'crm',
    originRunId: null,
    causationEventId: null,
    chainDepth: 0,
    idempotencyKey: 'k',
    status: 'pending',
    attempts: 0,
    availableAt: new Date().toISOString(),
    processedAt: null,
    lastError: null,
    createdAt: new Date().toISOString(),
  };
}

function ctx(
  db: unknown,
  overrides: Partial<ExecutionContext> = {}
): ExecutionContext {
  return {
    accountId: 'acct-1',
    contactId: 'contact-1',
    runId: 'run-1',
    automationId: 'auto-1',
    versionId: 'v1',
    event: event(),
    vars: {},
    now: new Date('2026-01-01T00:00:00.000Z'),
    db,
    ...overrides,
  };
}

/**
 * Minimal in-memory Supabase stand-in: eq-filtered select with
 * ordering/limits, plus insert/update writes. Enough for the CRM
 * nodes without touching the network.
 */
function mockDb(seed: Record<string, Array<Record<string, unknown>>>) {
  const tables: Record<string, Array<Record<string, unknown>>> = {};
  for (const [table, rows] of Object.entries(seed)) {
    tables[table] = rows.map((r) => ({ ...r }));
  }
  return {
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters: Array<(r: Record<string, unknown>) => boolean> = [];
      let update: Record<string, unknown> | null = null;
      let inserted: Record<string, unknown> | null = null;
      let orderKey: string | null = null;
      let orderAsc = true;
      let limit: number | null = null;
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return builder;
        },
        order: (col: string, opts?: { ascending?: boolean }) => {
          orderKey = col;
          orderAsc = opts?.ascending !== false;
          return builder;
        },
        limit: (n: number) => {
          limit = n;
          return builder;
        },
        insert: (payload: Record<string, unknown>) => {
          inserted = { id: crypto.randomUUID(), ...payload };
          return builder;
        },
        update: (payload: Record<string, unknown>) => {
          update = payload;
          return builder;
        },
        maybeSingle: async () => {
          if (inserted) {
            rows.push(inserted);
            const row = inserted;
            inserted = null;
            return { data: row, error: null };
          }
          const filtered = rows.filter((r) => filters.every((f) => f(r)));
          const out = orderKey
            ? [...filtered].sort((a, b) => {
                const x = a[orderKey as string];
                const y = b[orderKey as string];
                if (x === y) return 0;
                if (x == null) return 1;
                if (y == null) return -1;
                return (x < y ? -1 : 1) * (orderAsc ? 1 : -1);
              })
            : filtered;
          const limited = limit != null ? out.slice(0, limit) : out;
          if (update) {
            for (const r of limited) Object.assign(r, update);
            // `update` callers in nodes chain `.select().single()`;
            // fall through to single() semantics below via shared state.
            (builder as Record<string, unknown>).__updated = limited;
          }
          return { data: limited[0] ?? null, error: null };
        },
        single: async () => {
          if (inserted) {
            rows.push(inserted);
            const row = inserted;
            inserted = null;
            return { data: row, error: null };
          }
          const staged = (builder as Record<string, unknown>).__updated as
            | Array<Record<string, unknown>>
            | undefined;
          if (staged) {
            if (staged.length === 0) {
              return { data: null, error: { message: 'no row' } };
            }
            return { data: staged[0], error: null };
          }
          const out = rows.filter((r) => filters.every((f) => f(r)));
          if (out.length === 0) {
            return { data: null, error: { message: 'no row' } };
          }
          if (update) for (const r of out) Object.assign(r, update);
          return { data: out[0], error: null };
        },
      };
      return builder;
    },
  };
}

const dealRow = (overrides: Record<string, unknown> = {}) => ({
  id: DEAL,
  account_id: 'acct-1',
  pipeline_id: PIPE,
  stage_id: STAGE_A,
  contact_id: 'contact-1',
  title: 'Big deal',
  status: 'open',
  ...overrides,
});

const memberRow = (overrides: Record<string, unknown> = {}) => ({
  id: PROFILE,
  account_id: 'acct-1',
  user_id: USER,
  full_name: 'Ada',
  ...overrides,
});

describe('trigger.deal_stage_changed', () => {
  it('matches stage moves with optional pipeline/stage filters', () => {
    const base = {
      deal_id: DEAL,
      pipeline_id: PIPE,
      from_stage_id: STAGE_A,
      to_stage_id: STAGE_B,
    };
    expect(
      dealStageChangedTrigger.match?.(event(base), { mode: undefined } as never)
    ).toBe(true);
    expect(
      dealStageChangedTrigger.match?.(event(base), { pipelineId: PIPE })
    ).toBe(true);
    expect(
      dealStageChangedTrigger.match?.(event(base), { stageId: STAGE_B })
    ).toBe(true);
    expect(
      dealStageChangedTrigger.match?.(event(base), {
        pipelineId: '99999999-9999-9999-9999-999999999999',
      })
    ).toBe(false);
    expect(
      dealStageChangedTrigger.match?.(event(base), { stageId: STAGE_A })
    ).toBe(false);
    expect(
      dealStageChangedTrigger.match?.(
        { ...event(base), eventType: 'tag_added' },
        {}
      )
    ).toBe(false);
  });

  it('is registered, catalogued, and validates in a graph', () => {
    expect(defaultRegistry.require('trigger.deal_stage_changed')).toBe(
      dealStageChangedTrigger
    );
    const entry = catalogFromRegistry(defaultRegistry).find(
      (n) => n.type === 'trigger.deal_stage_changed'
    );
    expect(entry?.label).toBe('Deal stage changed');
    const graph = graphFromNodes(
      [
        { id: 't', type: 'trigger.deal_stage_changed', config: {} },
        {
          id: 's',
          type: 'action.send_text',
          config: { text: 'moved', channel: 'current' },
        },
      ],
      [{ source: 't', target: 's' }]
    );
    expect(validateGraph(graph, defaultRegistry)).toEqual([]);
  });
});

describe('action.move_deal', () => {
  const seed = () => ({
    deals: [dealRow()],
    pipeline_stages: [
      { id: STAGE_A, pipeline_id: PIPE },
      { id: STAGE_B, pipeline_id: PIPE },
    ],
    domain_events: [],
  });

  it('moves an explicit deal and reports the transition', async () => {
    const result = await moveDealAction.execute?.(ctx(mockDb(seed())), {
      dealId: DEAL,
      stageId: STAGE_B,
    });
    expect(result).toEqual({
      status: 'ok',
      output: { dealId: DEAL, stageId: STAGE_B, moved: true },
    });
  });

  it('falls back to the contact latest open deal', async () => {
    const result = await moveDealAction.execute?.(ctx(mockDb(seed())), {
      stageId: STAGE_B,
    });
    expect(result).toMatchObject({ status: 'ok' });
  });

  it('fails cleanly with no open deal, unknown deal, or foreign stage', async () => {
    const none = await moveDealAction.execute?.(ctx(mockDb(seed())), {
      dealId: '99999999-9999-9999-9999-999999999999',
      stageId: STAGE_B,
    });
    expect(none).toEqual({ status: 'fail', error: 'Deal not found' });

    const empty = await moveDealAction.execute?.(
      ctx(mockDb({ deals: [], pipeline_stages: [] })),
      { stageId: STAGE_B }
    );
    expect(empty).toEqual({ status: 'fail', error: 'contact has no open deal' });

    const foreign = await moveDealAction.execute?.(ctx(mockDb(seed())), {
      dealId: DEAL,
      stageId: '88888888-8888-8888-8888-888888888888',
    });
    expect(foreign).toEqual({
      status: 'fail',
      error: 'Stage not found for deal pipeline',
    });
  });

  it('summarizes and validates in a graph', () => {
    expect(
      moveDealAction.summarize?.({ dealId: DEAL, stageId: STAGE_B })
    ).toBe('Move deal to stage');
    const graph = graphFromNodes(
      [
        {
          id: 't',
          type: 'trigger.deal_stage_changed',
          config: {},
        },
        { id: 'm', type: 'action.move_deal', config: { stageId: STAGE_B } },
      ],
      [{ source: 't', target: 'm' }]
    );
    expect(validateGraph(graph, defaultRegistry)).toEqual([]);
  });
});

describe('task nodes', () => {
  const members = () => ({
    profiles: [memberRow()],
    accounts: [{ id: 'acct-1', owner_user_id: USER }],
  });

  it('create_task writes via the shared service and returns the id', async () => {
    const db = mockDb({ ...members(), tasks: [], domain_events: [] });
    const result = await createTaskAction.execute?.(ctx(db), {
      title: 'Follow up',
      assigneeProfileId: PROFILE,
    });
    expect(result).toMatchObject({ status: 'ok' });
    if (result?.status === 'ok') {
      expect((result.output as { title: string }).title).toBe('Follow up');
    }
  });

  it('create_task rejects unknown assignees', async () => {
    const result = await createTaskAction.execute?.(ctx(mockDb(members())), {
      title: 'Follow up',
      assigneeProfileId: '99999999-9999-9999-9999-999999999999',
    });
    expect(result).toEqual({
      status: 'fail',
      error: 'assignee is not an account member',
    });
  });

  it('complete_task finishes an explicit or latest-open task', async () => {
    const seed = {
      tasks: [
        {
          id: TASK,
          account_id: 'acct-1',
          contact_id: 'contact-1',
          title: 'Call back',
          status: 'open',
        },
      ],
      domain_events: [],
    };
    const explicit = await completeTaskAction.execute?.(ctx(mockDb(seed)), {
      taskId: TASK,
    });
    expect(explicit).toMatchObject({
      status: 'ok',
      output: { taskId: TASK, completed: true },
    });

    const latest = await completeTaskAction.execute?.(ctx(mockDb(seed)), {});
    expect(latest).toMatchObject({
      status: 'ok',
      output: { taskId: TASK, completed: true },
    });

    const done = await completeTaskAction.execute?.(
      ctx(
        mockDb({
          tasks: [
            {
              id: TASK,
              account_id: 'acct-1',
              contact_id: 'contact-1',
              title: 'Call back',
              status: 'completed',
            },
          ],
          domain_events: [],
        })
      ),
      { taskId: TASK }
    );
    expect(done).toMatchObject({
      status: 'ok',
      output: { taskId: TASK, completed: false },
    });

    const empty = await completeTaskAction.execute?.(
      ctx(mockDb({ tasks: [], domain_events: [] })),
      {}
    );
    expect(empty).toEqual({ status: 'fail', error: 'contact has no open task' });
  });
});

describe('action.assign_owner', () => {
  const seed = () => ({
    profiles: [memberRow()],
    conversations: [{ id: 'conv-1', account_id: 'acct-1', contact_id: 'contact-1' }],
    tasks: [
      {
        id: TASK,
        account_id: 'acct-1',
        contact_id: 'contact-1',
        title: 'Call back',
        status: 'open',
      },
    ],
    deals: [dealRow()],
  });

  it('assigns conversations, tasks, and deals through one node', async () => {
    const conv = await assignOwnerAction.execute?.(ctx(mockDb(seed())), {
      target: 'conversation',
      assigneeProfileId: PROFILE,
    });
    expect(conv).toMatchObject({
      status: 'ok',
      output: { conversationId: 'conv-1', assigneeProfileId: PROFILE },
    });

    const task = await assignOwnerAction.execute?.(ctx(mockDb(seed())), {
      target: 'task',
      assigneeProfileId: PROFILE,
    });
    expect(task).toMatchObject({
      status: 'ok',
      output: { taskId: TASK, assigneeProfileId: PROFILE },
    });

    const deal = await assignOwnerAction.execute?.(ctx(mockDb(seed())), {
      target: 'deal',
      assigneeProfileId: PROFILE,
    });
    expect(deal).toMatchObject({
      status: 'ok',
      output: { dealId: DEAL, assigneeProfileId: PROFILE },
    });
  });

  it('rejects unknown members and missing entities', async () => {
    const stranger = await assignOwnerAction.execute?.(ctx(mockDb(seed())), {
      target: 'conversation',
      assigneeProfileId: '99999999-9999-9999-9999-999999999999',
    });
    expect(stranger).toEqual({
      status: 'fail',
      error: 'assignee is not an account member',
    });

    const noConv = await assignOwnerAction.execute?.(
      ctx(mockDb({ profiles: [memberRow()] })),
      { target: 'conversation', assigneeProfileId: PROFILE }
    );
    expect(noConv).toEqual({
      status: 'fail',
      error: 'contact has no conversation',
    });
  });
});

describe('crm nodes in the catalog', () => {
  it('exposes all five nodes without engine switches', () => {
    const types = catalogFromRegistry(defaultRegistry).map((n) => n.type);
    for (const type of [
      'trigger.deal_stage_changed',
      'action.move_deal',
      'action.create_task',
      'action.complete_task',
      'action.assign_owner',
    ]) {
      expect(types).toContain(type);
    }
  });
});
