import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { mapRun } from '@/lib/automation';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await getCurrentAccount();
    const { data: auto, error: autoError } = await supabase
      .from('automations')
      .select('id')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (autoError) {
      return NextResponse.json({ error: autoError.message }, { status: 500 });
    }
    if (!auto) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data, error } = await supabase
      .from('automation_runs')
      .select('*, contacts(name, phone), automation_versions(version_number)')
      .eq('automation_id', id)
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const runs = (data ?? []).map((row) => {
      const run = mapRun(row as Record<string, unknown>);
      const contact = (row as { contacts?: { name?: string; phone?: string } })
        .contacts;
      const version = (
        row as { automation_versions?: { version_number?: number } }
      ).automation_versions;
      return {
        ...run,
        contactName: contact?.name ?? contact?.phone ?? null,
        versionNumber: version?.version_number ?? null,
      };
    });

    return NextResponse.json({ runs });
  } catch (error) {
    return toErrorResponse(error);
  }
}
