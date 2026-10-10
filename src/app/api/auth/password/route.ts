import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    const body = await objectBody(request, context);
    if (
      typeof body.password !== 'string' ||
      [...body.password].length < 8 ||
      [...body.password].length > 128 ||
      body.confirmPassword !== body.password ||
      Object.keys(body).some(
        (key) => !['password', 'confirmPassword'].includes(key),
      )
    )
      throw new ApiError(400, 'invalid-password');
    const {
      data: { user },
      error: authError,
    } = await context.client.auth.getUser();
    if (
      authError ||
      !user ||
      request.cookies.get('sgn-recovery')?.value !== user.id
    )
      throw new ApiError(401, 'invalid-recovery');
    const { error } = await context.client.auth.updateUser({
      password: body.password,
    });
    if (error) throw new ApiError(503, 'unavailable');
    const { error: signOutError } = await context.client.auth.signOut({
      scope: 'local',
    });
    if (signOutError) throw new ApiError(503, 'unavailable');
    const response = NextResponse.json({ updated: true });
    response.cookies.delete('sgn-recovery');
    return response;
  });
}
