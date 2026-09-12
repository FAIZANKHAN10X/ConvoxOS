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
  CONTACT_UPDATED: 'contact_updated',
  MESSAGE_RECEIVED: 'message_received',
  TASK_CREATED: 'task_created',
  TASK_COMPLETED: 'task_completed',
  TASK_OVERDUE: 'task_overdue',
  NOTE_ADDED: 'note_added',
  /** T6.2: a lead form was submitted (contact always resolved). */
  FORM_SUBMITTED: 'form_submitted',
  DEAL_STAGE_CHANGED: 'deal_stage_changed',
  DEAL_STATUS_CHANGED: 'deal_status_changed',
  DEAL_CREATED: 'deal_created',
  /**
   * Emitted on generic deal field updates (title/value/etc). No
   * trigger consumes it yet — T5.5 owns trigger coverage. Recorded
   * so the domain fact exists for the debugger + future triggers.
   */
  DEAL_UPDATED: 'deal_updated',
  /** Fired by automation_inbound_hooks (n8n, scripts, middleware). */
  EXTERNAL_RECEIVED: 'external.received',
} as const;

export type DomainEventType = (typeof DOMAIN_EVENT)[keyof typeof DOMAIN_EVENT];
