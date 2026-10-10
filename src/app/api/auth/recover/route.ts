import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    const body = await objectBody(request, context);
    if (
      typeof body.email !== 'string' ||
      body.email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email) ||
      (body.locale !== 'vi' && body.locale !== 'en') ||
      Object.keys(body).some((key) => key !== 'email' && key !== 'locale')
    )
      throw new ApiError(400, 'invalid-input');
    context.setLocale(body.locale);
    const { error } = await context.client.auth.resetPasswordForEmail(
      body.email.trim(),
      { redirectTo: context.environment.appUrl + '/auth/callback' },
    );
    if (error) throw new ApiError(503, 'unavailable');
    return NextResponse.json({ sent: true });
  });
}
