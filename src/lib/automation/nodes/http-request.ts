import { z } from 'zod';

import { safeFetch, SafeFetchError } from '@/lib/http/safe-fetch';
import {
  MAX_CAPTURED_BYTES,
  outboundDeliveryId,
  parseCapturedBody,
  withIdempotencyKey,
} from '@/lib/integrations/signed-post';

import { interpolateTemplate } from '../interpolate';
import { NodeExecutionError } from '../types';
import type { NodeDefinition } from '../types';

const httpMethod = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

const headerRow = z.object({
  name: z.string().min(1),
  value: z.string(),
});

const httpRequestConfig = z.object({
  method: httpMethod.default('POST'),
  url: z.string().min(1),
  headers: z.array(headerRow).optional(),
  body: z.string().optional(),
  captureResponse: z.boolean().default(false),
  timeoutMs: z.number().int().min(1000).max(30000).default(10000),
});

export type HttpRequestConfig = z.infer<typeof httpRequestConfig>;

function scopeFor(
  ctx: Parameters<NonNullable<NodeDefinition['execute']>>[0]
): Record<string, unknown> {
  return {
    accountId: ctx.accountId,
    contactId: ctx.contactId,
    runId: ctx.runId,
    automationId: ctx.automationId,
    event: { type: ctx.event.eventType, payload: ctx.event.payload },
    ...ctx.vars,
  };
}

export const httpRequestAction: NodeDefinition<HttpRequestConfig> = {
  type: 'action.http_request',
  kind: 'action',
  label: 'HTTP request',
  description: 'Call an external API (n8n, SaaS, webhooks)',
  category: 'integration',
  flags: { testable: true },
  fieldLabels: {
    method: { GET: 'GET', POST: 'POST', PUT: 'PUT', PATCH: 'PATCH', DELETE: 'DELETE' },
  },
  configSchema: httpRequestConfig,
  summarize(config) {
    try {
      const host = new URL(config.url).host;
      return `${config.method} ${host}`;
    } catch {
      return `${config.method} ${config.url}`;
    }
  },
  validate(config) {
    let parsed: URL;
    try {
      parsed = new URL(config.url);
    } catch {
      return ['URL must be an absolute http(s) URL — variables like {{…}} are resolved at run time, so keep a valid URL shape'];
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return ['URL must use http or https'];
    }
    return [];
  },
  async execute(ctx, config) {
    const scope = scopeFor(ctx);
    const url = interpolateTemplate(config.url, scope);
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return { status: 'fail', error: `invalid URL after interpolation: ${url}` };
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      return { status: 'fail', error: 'URL must use http or https' };
    }

    const headers: Record<string, string> = {};
    for (const row of config.headers ?? []) {
      headers[interpolateTemplate(row.name, scope)] = interpolateTemplate(
        row.value,
        scope
      );
    }
    const deliveryId = outboundDeliveryId(ctx);
    Object.assign(headers, withIdempotencyKey(headers, deliveryId));
    // GET cannot carry a body (undici throws; that would look like a
    // retryable network error). Empty interpolated bodies are omitted
    // so a blank form field does not send Content-Length: 0.
    const interpolatedBody =
      config.body === undefined
        ? undefined
        : interpolateTemplate(config.body, scope);
    const body =
      config.method === 'GET' || !interpolatedBody
        ? undefined
        : interpolatedBody;

    let res: Response;
    try {
      res = await safeFetch(target.toString(), {
        method: config.method,
        headers,
        body,
        timeoutMs: config.timeoutMs,
      });
    } catch (error) {
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

    const output: Record<string, unknown> = { status: res.status };
    if (config.captureResponse) {
      const text = await res.text();
      output.response = {
        status: res.status,
        body: parseCapturedBody(text.slice(0, MAX_CAPTURED_BYTES)),
        truncated: text.length > MAX_CAPTURED_BYTES,
      };
    }
    return { status: 'ok', output };
  },
};
