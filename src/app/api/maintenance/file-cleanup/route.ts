import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { providerServiceKey } from '@/features/employees/deactivation';
import { drainFileCleanup } from '@/features/property-files/cleanup-pass';
import { operatorCleanupLimit } from '@/features/property-files/upload-cleanup';

export const dynamic = 'force-dynamic';

// The operator action for the released-upload backlog. There is no scheduler in this
// deployment, so an operator presents the server-only service key as a bearer credential and
// the trusted server performs the same bounded delete-then-record pass that ordinary
// completion traffic drains opportunistically.
function presentsKey(request: NextRequest, serviceKey: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const presented = header.startsWith('Bearer ')
    ? header.slice('Bearer '.length).trim()
    : '';
  if (presented.length !== serviceKey.length) return false;
  return timingSafeEqual(Buffer.from(presented), Buffer.from(serviceKey));
}

export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    const serviceKey = providerServiceKey(process.env);
    if (!serviceKey)
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    if (!presentsKey(request, serviceKey))
      return NextResponse.json({ error: 'access-denied' }, { status: 401 });
    const summary = await drainFileCleanup(
      context.environment,
      operatorCleanupLimit,
    );
    if (!summary)
      return NextResponse.json({ error: 'unavailable' }, { status: 503 });
    return NextResponse.json(summary);
  });
}
