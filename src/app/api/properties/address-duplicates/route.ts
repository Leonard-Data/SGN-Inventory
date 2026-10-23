import { NextRequest, NextResponse } from 'next/server';
import { runRoute, objectBody } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import {
  addressDuplicates,
  exactKeys,
} from '@/features/property-maintenance/data';

// The pre-create warning's own read: which unarchived properties already record the address the
// form is about to save. It writes nothing and blocks nothing; the create itself is unchanged.
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const body = await objectBody(request, context);
    exactKeys(body, ['address']);
    return NextResponse.json(await addressDuplicates(context, body.address));
  });
}
