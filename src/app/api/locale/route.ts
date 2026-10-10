import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const body = await objectBody(request, context);
    if (
      (body.locale !== 'vi' && body.locale !== 'en') ||
      Object.keys(body).some((key) => key !== 'locale')
    )
      throw new ApiError(400, 'invalid-input');
    const { error } = await context.client.rpc('set_my_locale', {
      p_locale: body.locale,
    });
    if (error)
      throw new ApiError(
        error.code === '42501' ? 403 : 503,
        error.code === '42501' ? 'access-denied' : 'unavailable',
      );
    context.setLocale(body.locale);
    return NextResponse.json({ locale: body.locale });
  });
}
