# ConvoxOS Integration Layer

ConvoxOS is the native CRM and automation engine. This layer exists
for what should **not** be rebuilt inside it: external APIs, SaaS
integrations, n8n orchestration, and other systems' automation.

Rule of thumb: if it is a CRM operation (contacts, conversations,
tags, fields, tasks, deals, waits, branches, channel sends), it
belongs in a native automation. If it is an external problem
(HTTP APIs, third-party workflows, specialized processing), it goes
through here. ConvoxOS is never a wrapper around n8n.

## Directions

| Direction | Mechanism | Docs |
|---|---|---|
| ConvoxOS → n8n / external API | `action.http_request` node, or `action.n8n_workflow` wrapper | below |
| n8n → ConvoxOS events | `POST /api/hooks/<token>` → native automation | below |
| n8n → ConvoxOS CRM writes | Public REST (`/api/v1/*`) with scoped keys | `docs/public-api.md` |
| ConvoxOS → subscribers | Outbound event webhooks | `docs/public-api.md` |

## ConvoxOS → n8n: the HTTP request node

`action.http_request` (category: logic) calls any HTTPS endpoint
mid-run: method, URL, headers, and JSON body, all supporting
`{{path.to.value}}` interpolation against run context
(`accountId`, `contactId`, `runId`, `automationId`,
`event.{type,payload}`, plus accumulated `vars`). Missing paths
render as empty strings, so a typo fails loudly at the URL/parse
stage rather than sending a literal `{{…}}`.

Transport policy (shared with webhook delivery, see
`src/lib/http/safe-fetch.ts`): SSRF guard, no redirect following,
configurable 1–30s timeout (default 10s). Failures map onto the
engine's existing retries — timeouts, network errors, 408/429/5xx
retry with backoff; 4xx and SSRF refusals fail the run
immediately. Responses are recorded per attempt in run history;
`captureResponse` stores `{status, body, truncated}` (32KB cap) in
the step output for downstream conditions.

## ConvoxOS → n8n: the workflow node

`action.n8n_workflow` is a thin convenience wrapper over the same
machinery — not a second engine. It loads a stored
`integration_endpoints` row (account-scoped, `is_active` checked),
signs the delivery with the endpoint's secret, and POSTs a fixed
envelope:

```json
{
  "id": "<delivery uuid — dedupe on this>",
  "event": "automation.n8n_call",
  "occurred_at": "<iso>",
  "account_id": "<uuid>",
  "data": {
    "contact_id": "<uuid>",
    "run_id": "<uuid>",
    "automation_id": "<uuid>",
    "event_type": "<triggering event>",
    "...mapped fields from the node config..."
  }
}
```

Headers: `Content-Type: application/json`,
`X-Wacrm-Event: automation.n8n_call`,
`X-Wacrm-Signature: t=<unix>,v1=<hex HMAC-SHA256>` over
`"<t>.<exact raw body>"`. Create endpoints via
`POST /api/v1/integrations` (scope `integrations:manage`) — the
secret is shown once. Delete via
`DELETE /api/v1/integrations/[id]`; in-flight runs fail closed.

## n8n → ConvoxOS: inbound webhooks

Create a hook per automation via
`POST /api/v1/integrations/hooks` (`{"automation_id": "…"}`,
scope `integrations:manage`). The response contains the full `url`,
bearer `token`, and HMAC `secret` — each shown exactly once.
Rotating (POST again) invalidates the previous pair; delete via
`DELETE /api/v1/integrations/hooks/[hookId]`.

Deliveries are `POST <url>` with a JSON object body and the headers:

- `X-Wacrm-Signature: t=<unix>,v1=<hex>` (required, 300s tolerance)
- `X-Wacrm-Delivery-Id: <string>` (optional — enables
  end-to-end dedupe; without it each delivery is a new event)

A valid delivery becomes an `external.received` domain event and
enters the standard worker pipeline: trigger matching, runs,
waits, retries, and history behave exactly like native events.
Only automations whose `trigger.inbound_webhook` references that
hook fire. Contact resolution is lookup-only: `contact_id` (must
belong to the account) else `phone`, else the event is logged
contactless and starts no run. Unknown/inactive hooks 404 alike;
bad signatures 401; oversized bodies 413.

### Verifying `X-Wacrm-Signature` in n8n (Code node)

n8n has no native HMAC-verify node — paste this in a Code node
running **before** any processing. It uses the hook secret from an
n8n credential or expression, never hardcoded if avoidable:

```javascript
// n8n Code node (JavaScript): verify a ConvoxOS inbound delivery.
// Expects binary-free JSON input; run mode "Run Once for All Items".
const crypto = require('crypto');

const rawBody = $json._rawBody ?? JSON.stringify($json);
// NOTE: sign/verify MUST use the exact raw request bytes. In the
// n8n Webhook node, set "Response Mode: When Received" is unrelated;
// to preserve raw bytes, read them from the webhook's raw body.
// If your n8n version parses first, store $request.body as text via
// a preceding Code node instead of re-serializing here.
const SECRET = $credentials?.convoxosHookSecret
  ?? $env.CONVOXOS_HOOK_SECRET;
const header = $headers['x-wacrm-signature'] ?? '';
const now = Math.floor(Date.now() / 1000);

function fail(why) {
  throw new Error(`ConvoxOS signature rejected: ${why}`);
}

const m = /^t=(\d+),v1=([0-9a-f]{64})$/i.exec(header.trim());
if (!m) fail('missing or malformed X-Wacrm-Signature');
const [, t, v1] = m;
if (Math.abs(now - Number(t)) > 300) fail('timestamp outside tolerance');

const expected = crypto
  .createHmac('sha256', SECRET)
  .update(`${t}.${rawBody}`)
  .digest('hex');

const a = Buffer.from(expected, 'hex');
const b = Buffer.from(v1.toLowerCase(), 'hex');
if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
  fail('HMAC mismatch');
}

return [{ json: $json }];
```

On success, branch to an HTTP Request or ConvoxOS node; on throw,
n8n marks the execution failed and nothing reaches ConvoxOS beyond
the already-answered `202`/`4xx`.

## Example: lead enrichment round-trip

1. Native trigger `tag.added` (`Hot Lead`) → `action.n8n_workflow`
   mapping `{ lead_id: "{{vars.leadId}}" }` → n8n enriches via
   Clearbit-style API → n8n POSTs
   `/api/hooks/<token>` `{ contact_id, enriched: {...} }` →
   the same automation's `trigger.inbound_webhook` (second
   automation or re-entry) → native `Update contact field` +
   `Add tag`. Every hop is idempotent; every failure lands in run
   history with its verdict.

## Security model (summary)

- Secrets AES-256-GCM at rest, plaintext shown once, never
  RLS-selected by clients (`lib/whatsapp/encryption.ts`).
- Hook tokens SHA-256-hashed like API keys; scanners get 404s.
- SSRF guard + no-redirect + timeout on every caller-influenced URL.
- Scopes-only API auth (`integrations:manage` added; no migration).
- Per-key/per-hook rate limits via the existing limiter.
- Account scoping enforced at every DB access (service-role
  client, explicit `account_id` predicates — same as the v1 API).
