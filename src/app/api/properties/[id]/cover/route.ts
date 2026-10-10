import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
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
    const expectedKeys = ['fileId'];
    if (
      Object.keys(body).some((key) => !expectedKeys.includes(key)) ||
      (body.fileId !== null && typeof body.fileId !== 'string') ||
      (body.fileId !== null && body.fileId !== '' && !/^[0-9a-f-]{36}$/i.test(body.fileId))
    )
      throw new ApiError(400, 'invalid-input');
    const fileId: string | null = body.fileId === '' || body.fileId === null ? null : body.fileId;
    return NextResponse.json(await setCover(context, propertyId, fileId));
  });
}
