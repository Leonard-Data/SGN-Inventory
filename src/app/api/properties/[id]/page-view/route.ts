import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute, uuid } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
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
    const { data: eventId, error } = await context.client.rpc(
      'record_property_activity',
      { p_property_id: id, p_kind: 'page_view', p_key: body.key },
    );
    if (error)
      throw new ApiError(
        error.code === '42501' ? 403 : error.code === 'P0001' ? 400 : 503,
        error.code === '42501'
          ? 'access-denied'
          : error.code === 'P0001'
            ? 'invalid-input'
            : 'unavailable',
      );
    return NextResponse.json({ eventId });
  });
}
