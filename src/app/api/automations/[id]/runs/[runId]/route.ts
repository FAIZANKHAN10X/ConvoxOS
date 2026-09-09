import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { mapRun, mapStep } from '@/lib/automation';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> }
) {
  try {
    const { id, runId } = await params;
    const { supabase, accountId } = await getCurrentAccount();
    const { data: runRow, error } = await supabase
      .from('automation_runs')
      .select('*, contacts(name, phone), automation_versions(version_number)')
      .eq('id', runId)
      .eq('automation_id', id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!runRow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const { data: stepRows, error: stepError } = await supabase
      .from('automation_run_steps')
      .select('*')
      .eq('run_id', runId)
      .eq('account_id', accountId)
      .order('started_at', { ascending: true });
    if (stepError) {
      return NextResponse.json({ error: stepError.message }, { status: 500 });
    }

    const contact = (runRow as { contacts?: { name?: string; phone?: string } })
      .contacts;
    const version = (
      runRow as { automation_versions?: { version_number?: number } }
    ).automation_versions;

    return NextResponse.json({
      run: {
        ...mapRun(runRow as Record<string, unknown>),
        contactName: contact?.name ?? contact?.phone ?? null,
        versionNumber: version?.version_number ?? null,
      },
      steps: (stepRows ?? []).map((row) =>
        mapStep(row as Record<string, unknown>)
      ),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
