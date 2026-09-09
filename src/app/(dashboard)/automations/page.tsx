import { catalogFromRegistry, defaultRegistry } from '@/lib/automation';

import { AutomationList } from '@/components/automations/automation-list';

export default function AutomationsPage() {
  const catalog = catalogFromRegistry(defaultRegistry);
  return <AutomationList catalog={catalog} />;
}
