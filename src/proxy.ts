import { NextRequest, NextResponse } from 'next/server';
import {
  ApiError,
  createRouteContext,
  type RouteContext,
} from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { mayReadDirectory } from '@/features/employees/directory';
import { messages } from '@/i18n/messages';
export async function proxy(request: NextRequest) {
  let context: RouteContext | undefined;
  try {
    context = createRouteContext(request);
    await context.client.auth.getClaims();
    const path = request.nextUrl.pathname;
    if (path.startsWith('/properties') || path.startsWith('/people')) {
      try {
        const employee = await activeEmployee(context);
        // People is not one authority boundary. The employee list is admin-only in the
        // rail and the same rule guards its route, so a direct visit is refused before
        // the shell renders. Vendors is readable by every active employee (already
        // proved above); its mutations are checked in the route and the database, not by
        // a page guard.
        if (
          path.startsWith('/people/employees') &&
          !mayReadDirectory(employee.role)
        )
          return context.finish(
            NextResponse.redirect(
              new URL('/access-denied', context.environment.appUrl),
            ),
          );
        context.setLocale(employee.locale);
      } catch (error) {
        if (
          error instanceof ApiError &&
          (error.status === 401 || error.status === 403)
        )
          return context.finish(
            NextResponse.redirect(
              new URL(
                error.status === 401 ? '/login' : '/access-denied',
                context.environment.appUrl,
              ),
            ),
          );
        throw error;
      }
    }
    return context.finish(NextResponse.next({ request }));
  } catch {
    const locale =
      request.cookies.get('sgn-locale')?.value === 'en' ? 'en' : 'vi';
    const response = new NextResponse(messages[locale].unavailable, {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
    return context ? context.finish(response) : response;
  }
}
export const config = {
  matcher: [
    '/properties/:path*',
    '/people/:path*',
    '/login',
    '/access-denied',
    '/recover',
    '/reset-password',
    '/auth/:path*',
  ],
};
