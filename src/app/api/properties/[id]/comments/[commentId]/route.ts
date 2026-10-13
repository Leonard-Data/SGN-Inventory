import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { editComment, exactComment } from '@/features/property-comments/data';

export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string; commentId: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const { id, commentId } = await route.params;
    return NextResponse.json({
      comment: await exactComment(context, id, commentId),
    });
  });
}

export function PATCH(
  request: NextRequest,
  route: { params: Promise<{ id: string; commentId: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const { id, commentId } = await route.params;
    // 2000 Vietnamese characters plus JSON overhead exceed the default request bound.
    const comment = await editComment(
      context,
      id,
      commentId,
      await objectBody(request, context, 16384),
    );
    return NextResponse.json({ comment });
  });
}
