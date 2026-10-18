import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import { acceptInvitation } from '@/features/employees/invitation-acceptance-data';

// Issue #69: complete the invitee's setup. The guarded RPC validates the current recorded
// invitation and the exact intended sign-in identity before linking and activating, so a
// wrong identity, a consumed or stale invitation or a deactivated employee is refused with no
// authority and no credential is written for them. The invitee activates themselves
// immediately on success — no manager approval.
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    const body = await objectBody(request, context);
    return NextResponse.json(await acceptInvitation(context, body));
  });
}
