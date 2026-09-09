import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { catalogFromRegistry, defaultRegistry } from '@/lib/automation';

export async function GET() {
  try {
    await getCurrentAccount();
    return NextResponse.json({
      nodes: catalogFromRegistry(defaultRegistry),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
