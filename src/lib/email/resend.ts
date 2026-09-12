// Resend provider client — plain fetch, no SDK dependency.
// Provider-specific; the CRM host never imports this directly for
// sends (see channels/socket.ts dispatch) except config validation.

export class ResendApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(code: string, message: string, status: number, retryable = false) {
    super(message);
    this.name = 'ResendApiError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

const RESEND_API_BASE = 'https://api.resend.com';

function sanitizeResendMessage(raw: string, fallback: string): string {
  const msg = raw.trim();
  if (!msg) return fallback;
  // Never echo key-like content; Resend errors are short phrases like
  // "Invalid API key" / "Validation error". Map known cases, truncate rest.
  const lower = msg.toLowerCase();
  if (lower.includes('invalid') && lower.includes('api key')) {
    return 'Invalid Resend API key — check the key from the Resend dashboard.';
  }
  if (lower.includes('validation')) {
    return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
  }
  if (lower.includes('rate') || lower.includes('too many')) {
    return 'Resend is rate limiting requests — try again shortly.';
  }
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}

async function resendFetch(
  apiKey: string,
  path: string,
  init?: RequestInit & { idempotencyKey?: string }
): Promise<unknown> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (init?.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
  let res: Response;
  try {
    res = await fetch(`${RESEND_API_BASE}${path}`, { ...init, headers });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ResendApiError(
      'network_error',
      `Could not reach Resend: ${sanitizeResendMessage(msg, 'Network error')}`,
      502,
      true
    );
  }
  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    if (!res.ok) {
      throw new ResendApiError(
        'resend_error',
        `Resend error ${res.status}`,
        res.status >= 500 ? 502 : 400,
        res.status >= 500
      );
    }
    return json;
  }
  if (res.ok) return json;
  const body = json as { message?: string; name?: string };
  const desc = sanitizeResendMessage(
    body.message ?? `Resend error ${res.status}`,
    `Resend error ${res.status}`
  );
  const retryable = res.status === 429 || res.status >= 500;
  const code =
    res.status === 401 || res.status === 403
      ? 'invalid_key'
      : res.status === 429
        ? 'rate_limited'
        : 'resend_error';
  // Map auth failures to 400 so the UI shows "invalid key", not a leak.
  const status = res.status === 401 || res.status === 403 ? 400 : res.status >= 500 ? 502 : 400;
  throw new ResendApiError(code, desc, status, retryable);
}

/** Validate an API key with an authenticated read (no send). */
export async function verifyResendApiKey(apiKey: string): Promise<{ ok: true }> {
  await resendFetch(apiKey, '/domains');
  return { ok: true };
}

export interface ResendSendParams {
  from: string;
  to: string[];
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  idempotencyKey?: string;
}

export interface ResendSendResult {
  /** Resend email id (UUID string) — stable provider message id. */
  id: string;
}

/**
 * Send one transactional email. At least one of text/html required.
 * Idempotency-Key makes automation retries safe provider-side.
 */
export async function sendResendEmail(
  apiKey: string,
  params: ResendSendParams
): Promise<ResendSendResult> {
  const to = params.to.map((t) => t.trim()).filter(Boolean);
  if (to.length === 0) {
    throw new ResendApiError('bad_request', 'At least one recipient is required', 400);
  }
  if (!params.subject.trim()) {
    throw new ResendApiError('bad_request', 'Subject is required', 400);
  }
  if (!params.text?.trim() && !params.html?.trim()) {
    throw new ResendApiError('bad_request', 'Text or HTML body is required', 400);
  }
  const body: Record<string, unknown> = {
    from: params.from,
    to,
    subject: params.subject,
  };
  if (params.text?.trim()) body.text = params.text;
  if (params.html?.trim()) body.html = params.html;
  if (params.replyTo) body.reply_to = params.replyTo;
  if (params.headers) body.headers = params.headers;
  const json = (await resendFetch(apiKey, '/emails', {
    method: 'POST',
    body: JSON.stringify(body),
    idempotencyKey: params.idempotencyKey,
  })) as { id?: unknown };
  if (typeof json.id !== 'string' || !json.id) {
    throw new ResendApiError('resend_error', 'Resend did not return an email id.', 502);
  }
  return { id: json.id };
}
