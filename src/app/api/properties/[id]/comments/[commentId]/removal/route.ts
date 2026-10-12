import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { removeComment } from '@/features/property-comments/data';

export function POST(
  request: NextRequest,
  route: { params: Promise<{ id: string; commentId: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const { id, commentId } = await route.params;
    // A 2,000-character moderation reason plus JSON overhead fits one bounded read.
    const comment = await removeComment(
      context,
      id,
      commentId,
      await objectBody(request, context, 16384),
    );
    return NextResponse.json({ comment });
  });
}
