import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute, uuid } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { setCover } from '@/features/property-files/cover-data';

export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const body = await objectBody(request, context);
    const propertyId = (await route.params).id;
    if (Object.keys(body).length !== 1 || (body.fileId !== null && !uuid(body.fileId)))
      throw new ApiError(400, 'invalid-input');
    return NextResponse.json(await setCover(context, propertyId, body.fileId));
  });
}
