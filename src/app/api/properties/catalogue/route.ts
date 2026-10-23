import { NextRequest, NextResponse } from 'next/server';
import { ApiError, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { catalogueRequest } from '@/features/properties/catalogue';
import { cataloguePage } from '@/features/properties/catalogue-data';

// One bounded page of the caller's authorized inventory as browsing summaries (ADR 0003). The
// caller's own session client enforces row level security, so an unauthenticated or inactive
// request is refused and a caller receives only the rows and fields they may receive. The response
// is private and never cached by a shared cache.
export function GET(request: NextRequest) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    // The cursor is the read's only parameter: anything else in the address is refused instead of
    // being answered with a page the caller did not ask for.
    const asked = catalogueRequest(request.nextUrl.searchParams);
    if (!asked.ok) throw new ApiError(400, 'invalid-input');
    return NextResponse.json(await cataloguePage(context, asked.after));
  });
}
