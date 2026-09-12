import { Suspense } from 'react';
import { Loader2 } from 'lucide-react';

import { catalogFromRegistry, defaultRegistry } from '@/lib/automation';

import { AutomationList } from '@/components/automations/automation-list';

export default function AutomationsPage() {
  const catalog = catalogFromRegistry(defaultRegistry);
  // Suspense shell for prerender/instant-navigation validation —
  // fallback mirrors AutomationList's own loading spinner.
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center" aria-hidden>
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      }
    >
      <AutomationList catalog={catalog} />
    </Suspense>
  );
}
