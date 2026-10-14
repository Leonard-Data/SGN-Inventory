import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { commentPage, postComment } from '@/features/property-comments/data';

export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await commentPage(
        context,
        (await route.params).id,
        request.nextUrl.searchParams,
      ),
    );
  });
}
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const id = (await route.params).id;
    // 2000 Vietnamese characters plus JSON overhead exceed the default request bound.
    const comment = await postComment(
      context,
      id,
      await objectBody(request, context, 16384),
    );
    return NextResponse.json({ comment });
  });
}
