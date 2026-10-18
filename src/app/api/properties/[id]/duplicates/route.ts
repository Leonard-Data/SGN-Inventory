import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  addressGroup,
  mergeDuplicates,
} from '@/features/properties/duplicate-data';

export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await addressGroup(context, (await route.params).id),
    );
  });
}

// Merging is a deliberate manager/admin action: the confirmation in the browser names both
// records, and the database re-checks the role, the address and the surviving record itself.
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await mergeDuplicates(
        context,
        (await route.params).id,
        await objectBody(request, context),
      ),
    );
  });
}
