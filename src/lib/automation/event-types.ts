/**
 * Durable CRM event vocabulary. The engine matches on these strings;
 * nodes own the rest. Adding a type here does not require an engine
 * switch — emit at the CRM mutation site and register a trigger that
 * `match()`es the type.
 */
export const DOMAIN_EVENT = {
  TAG_ADDED: 'tag_added',
  TAG_REMOVED: 'tag_removed',
  CONTACT_CREATED: 'contact_created',
  MESSAGE_RECEIVED: 'message_received',
  TASK_CREATED: 'task_created',
  TASK_COMPLETED: 'task_completed',
  /** Fired by automation_inbound_hooks (n8n, scripts, middleware). */
  EXTERNAL_RECEIVED: 'external.received',
} as const;

export type DomainEventType = (typeof DOMAIN_EVENT)[keyof typeof DOMAIN_EVENT];
