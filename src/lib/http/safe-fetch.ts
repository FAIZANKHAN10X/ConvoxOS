// ============================================================
// Safe outbound HTTP — shared by webhook delivery and integration
// nodes (generic HTTP action, n8n workflow calls).
//
// One policy everywhere a server makes a request to a
// caller-influenced URL:
//   - SSRF guard (`isDeliverableUrl`) before connect,
//   - `redirect: 'manual'` so a public URL can't 3xx-bounce internal,
//   - `AbortSignal.timeout` so a hanging sink can't burn a worker tick,
//   - typed errors carrying a retry verdict for the automation engine.
//
// Extracted verbatim-behavior from `lib/webhooks/deliver.ts`; that
// module keeps its own delivery semantics (failure counting,
// auto-disable) on top.
// ============================================================

import { isDeliverableUrl } from '@/lib/webhooks/ssrf';

export type SafeFetchErrorCode =
  | 'ssrf_refused'
  | 'timeout'
  | 'network'
  | 'http_error';

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly status?: number;
  /** Whether the automation engine should retry with backoff. */
  readonly retryable: boolean;

  constructor(
    code: SafeFetchErrorCode,
    message: string,
    retryable: boolean,
    status?: number
  ) {
    super(message);
    this.name = 'SafeFetchError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Per-request budget. Defaults to SAFE_FETCH_DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
}

/** Matches the historical webhook delivery budget. */
export const SAFE_FETCH_DEFAULT_TIMEOUT_MS = 5000;

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * POST/PUT/… to `url` with the shared safety policy. Resolves with
 * the response (caller decides what a status means) or throws a
 * `SafeFetchError`. Never follows redirects; never touches private
 * address space.
 */
export async function safeFetch(
  url: string,
  options: SafeFetchOptions = {}
): Promise<Response> {
  if (!(await isDeliverableUrl(url))) {
    throw new SafeFetchError(
      'ssrf_refused',
      `refusing non-public delivery target: ${url}`,
      false
    );
  }

  const { method = 'POST', headers, body } = options;
  const timeoutMs = options.timeoutMs ?? SAFE_FETCH_DEFAULT_TIMEOUT_MS;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body,
      // Do NOT follow redirects — a public URL could 3xx-bounce to an
      // internal address, bypassing the SSRF check above.
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      throw new SafeFetchError(
        'timeout',
        `request to ${url} timed out after ${timeoutMs}ms`,
        true
      );
    }
    throw new SafeFetchError(
      'network',
      err instanceof Error ? err.message : 'request failed',
      true
    );
  }

  if (!res.ok) {
    throw new SafeFetchError(
      'http_error',
      `endpoint responded ${res.status}`,
      isRetryableStatus(res.status),
      res.status
    );
  }

  return res;
}
