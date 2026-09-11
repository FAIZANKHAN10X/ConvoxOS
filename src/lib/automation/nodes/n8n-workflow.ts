import { z } from 'zod';

import { SafeFetchError } from '@/lib/http/safe-fetch';
import {
  decryptEndpointSecret,
  getIntegrationEndpoint,
} from '@/lib/integrations/endpoints';
import {
  outboundDeliveryId,
  postSignedJson,
} from '@/lib/integrations/signed-post';

import { interpolateTemplate } from '../interpolate';
import { NodeExecutionError } from '../types';
import type { NodeDefinition } from '../types';
import { asDb } from './db';

const mappedField = z.object({
  key: z.string().min(1),
  value: z.string(),
});

const n8nWorkflowConfig = z.object({
  endpointId: z.string().uuid(),
  fields: z.array(mappedField).optional(),
  captureResponse: z.boolean().default(true),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
});

export type N8nWorkflowConfig = z.infer<typeof n8nWorkflowConfig>;

/**
 * Thin convenience wrapper over the generic HTTP machinery — not a
 * second integration engine. Loads a stored n8n endpoint reference,
 * signs the delivery with its secret, and POSTs through safe-fetch,
 * so SSRF/timeout/redirect policy and engine retries are identical
 * to `action.http_request`. n8n replies flow back via
 * `trigger.inbound_webhook`; n8n writes CRM data via the public REST
 * API. Native CRM logic never moves into n8n.
 */
export const n8nWorkflowAction: NodeDefinition<N8nWorkflowConfig> = {
  type: 'action.n8n_workflow',
  kind: 'action',
  label: 'n8n workflow',
  description: 'Run an n8n workflow, then continue',
  category: 'integration',
  flags: { testable: true },
  configSchema: n8nWorkflowConfig,
  summarize() {
    return 'Call n8n workflow';
  },
  async execute(ctx, config) {
    const db = asDb(ctx);
    const endpoint = await getIntegrationEndpoint(db, {
      accountId: ctx.accountId,
      endpointId: config.endpointId,
    });
    if (!endpoint || !endpoint.is_active) {
      return { status: 'fail', error: 'n8n endpoint missing or disabled' };
    }

    let secret: string;
    try {
      secret = decryptEndpointSecret(endpoint.secret_enc);
    } catch {
      return { status: 'fail', error: 'n8n endpoint secret unreadable' };
    }

    const scope: Record<string, unknown> = {
      accountId: ctx.accountId,
      contactId: ctx.contactId,
      runId: ctx.runId,
      automationId: ctx.automationId,
      event: { type: ctx.event.eventType, payload: ctx.event.payload },
      ...ctx.vars,
    };
    const data: Record<string, unknown> = {
      contact_id: ctx.contactId,
      run_id: ctx.runId,
      automation_id: ctx.automationId,
      event_type: ctx.event.eventType,
    };
    for (const row of config.fields ?? []) {
      data[interpolateTemplate(row.key, scope)] = interpolateTemplate(
        row.value,
        scope
      );
    }

    try {
      const result = await postSignedJson({
        url: endpoint.url,
        secret,
        payload: data,
        event: 'automation.n8n_call',
        accountId: ctx.accountId,
        timeoutMs: config.timeoutMs,
        deliveryId: outboundDeliveryId(ctx),
      });
      void touchEndpoint(db, endpoint.id, true).catch(() => undefined);
      const output: Record<string, unknown> = { status: result.status };
      if (config.captureResponse) {
        output.response = {
          status: result.status,
          body: result.body,
          truncated: result.truncated,
        };
      }
      return { status: 'ok', output };
    } catch (error) {
      void touchEndpoint(db, endpoint.id, false).catch(() => undefined);
      if (error instanceof SafeFetchError) {
        throw new NodeExecutionError(error.message, error.retryable, {
          status: error.status,
          response:
            error.body !== undefined
              ? {
                  status: error.status,
                  body: error.body,
                  truncated: error.truncated ?? false,
                }
              : undefined,
        });
      }
      throw error;
    }
  },
};

/**
 * Best-effort observability bookkeeping. Never fails the run — the
 * step result already records success/failure per attempt.
 */
async function touchEndpoint(
  db: ReturnType<typeof asDb>,
  endpointId: string,
  ok: boolean
): Promise<void> {
  if (ok) {
    await db
      .from('integration_endpoints')
      .update({
        failure_count: 0,
        last_delivery_at: new Date().toISOString(),
      })
      .eq('id', endpointId);
    return;
  }
  const { data } = await db
    .from('integration_endpoints')
    .select('failure_count')
    .eq('id', endpointId)
    .maybeSingle();
  const row = data as { failure_count?: number } | null;
  await db
    .from('integration_endpoints')
    .update({ failure_count: (row?.failure_count ?? 0) + 1 })
    .eq('id', endpointId);
}
