import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { addContactNumber } from '@/features/properties/contact-number';

// A property's contact capture: any live active employee records a contact number on an
// unarchived property, re-checked here and again inside the guarded operation. The recorded
// contact is a new row beside the earlier ones, never a rewrite of them.
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await addContactNumber(
        context,
        (await route.params).id,
        await objectBody(request, context, 32 * 1024),
      ),
      { status: 201 },
    );
  });
}
