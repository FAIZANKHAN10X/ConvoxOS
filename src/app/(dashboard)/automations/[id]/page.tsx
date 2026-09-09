import { notFound } from 'next/navigation';

import { getCurrentAccount } from '@/lib/auth/account';
import {
  catalogFromRegistry,
  createPostgresStore,
  defaultRegistry,
} from '@/lib/automation';
import { BuilderShell } from '@/components/automations/builder-shell';

export default async function AutomationBuilderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getCurrentAccount();
  const store = createPostgresStore(ctx.supabase);
  const automation = await store.getAutomation(id);
  if (!automation || automation.accountId !== ctx.accountId) {
    notFound();
  }
  const catalog = catalogFromRegistry(defaultRegistry);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <BuilderShell initial={automation} catalog={catalog} />
    </div>
  );
}
