import { NextRequest, NextResponse } from 'next/server';
import { runRoute } from '@/lib/supabase/route';
import { activeEmployee } from '@/features/employees/access';
import { contactNameById } from '@/features/contacts/data';
// The bounded name-only read of one recorded identity, used to label an applied filter
// condition. It reads the same `contacts` member read the directory lists with and runs no
// affected-property guard, so a name never depends on the caller's preview authority.
export function GET(
  request: NextRequest,
  route: { params: Promise<{ id: string }> },
) {
  return runRoute(request, async (context) => {
    await activeEmployee(context);
    return NextResponse.json(
      await contactNameById(context, (await route.params).id),
    );
  });
}
