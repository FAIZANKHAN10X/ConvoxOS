import { supabaseAdmin } from '@/lib/supabase/admin';

import { createEngineDeps } from './deps';
import { processDomainEvent, runAutomationWorker } from './worker';

/**
 * Fire-and-forget drain after a CRM mutation. Failures stay in
 * `domain_events` / waits for the scheduled worker to retry.
 */
export function kickDomainEvent(eventId: string): void {
  void processDomainEvent(createEngineDeps(supabaseAdmin()), eventId).catch(
    (error: unknown) => {
      console.error('[automation] domain event worker failed:', error);
    }
  );
}

export function kickAutomationWorker(): void {
  void runAutomationWorker(createEngineDeps()).catch((error: unknown) => {
    console.error('[automation] due-work worker failed:', error);
  });
}
