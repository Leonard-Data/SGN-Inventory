import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    const body = await objectBody(request, context);
    if (Object.keys(body).length) throw new ApiError(400, 'invalid-input');
    const { error } = await context.client.auth.signOut({ scope: 'local' });
    if (error) throw new ApiError(503, 'unavailable');
    const response = new NextResponse(null, { status: 204 });
    response.cookies.delete('sgn-recovery');
    return response;
  });
}
