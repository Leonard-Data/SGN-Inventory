import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { editComment } from '@/features/property-comments/data';

// The author's guarded edit of their own current comment on an unarchived Property.
export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string; commentId: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const { id, commentId } = await route.params;
    const comment = await editComment(
      context,
      id,
      commentId,
      // 2000 Vietnamese characters plus JSON overhead exceed the default request bound.
      await objectBody(request, context, 16384),
    );
    return NextResponse.json({ comment });
  });
}
