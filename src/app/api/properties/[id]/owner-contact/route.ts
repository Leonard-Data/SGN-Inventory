import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute, uuid } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { revealOwnerContact } from '@/features/properties/owner-contact';
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const id = (await route.params).id;
    const body = await objectBody(request, context);
    if (
      !uuid(id) ||
      !uuid(body.key) ||
      Object.keys(body).some((key) => key !== 'key')
    )
      throw new ApiError(400, 'invalid-input');
    return NextResponse.json(await revealOwnerContact(context, id, body.key));
  });
}
