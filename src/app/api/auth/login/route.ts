import { NextRequest, NextResponse } from 'next/server';
import {
  ApiError,
  credentials,
  objectBody,
  runRoute,
} from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    const input = credentials(await objectBody(request, context));
    context.setLocale(input.locale);
    const { error } = await context.client.auth.signInWithPassword(input);
    if (error) {
      const unavailable =
        !error.status || error.status >= 500 || error.status === 429;
      throw new ApiError(
        unavailable ? 503 : 401,
        unavailable ? 'unavailable' : 'invalid-credentials',
      );
    }
    const employee = await activeEmployee(context);
    context.setSessionPersistence(input.remember);
    context.setLocale(employee.locale);
    return NextResponse.json({ employee });
  });
}
