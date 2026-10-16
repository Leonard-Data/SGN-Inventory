import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { commentHistory } from '@/features/property-comments/data';

export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string; commentId: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    const { id, commentId } = await route.params;
    return NextResponse.json(
      await commentHistory(context, id, commentId),
    );
  });
}
