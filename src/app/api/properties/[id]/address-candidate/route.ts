import { NextRequest, NextResponse } from 'next/server';
import { runRoute, objectBody } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { recordCandidate } from '@/features/property-maintenance/data';
// One explicit action after a legacy address is saved: record the current address the official
// crosswalk names, as an unverified candidate. Nothing writes it automatically.
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await recordCandidate(
        context,
        (await route.params).id,
        await objectBody(request, context, 16 * 1024),
      ),
    );
  });
}
