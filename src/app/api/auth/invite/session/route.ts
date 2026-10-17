import { NextRequest, NextResponse } from 'next/server';
import { objectBody, runRoute } from '@/lib/supabase/route';
import {
  establishInvitationSession,
  invitationSessionStatus,
} from '@/features/employees/invitation-acceptance-data';

// Issue #69: the delivered invite link lands here with the invite session in its fragment.
// The client reads the fragment and posts it; this establishes the session from the exact
// delivered tokens and reports the current acceptance step, never a delivery or an access
// claim. Neither the token nor the identity is logged or cached.
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    const body = await objectBody(request, context);
    await establishInvitationSession(context, body);
    const status = await invitationSessionStatus(context);
    return NextResponse.json(status);
  });
}
