import { NextRequest, NextResponse } from 'next/server';
import { ApiError, objectBody, runRoute } from '@/lib/supabase/route';
import {
  establishInvitationSession,
  invitationProofValid,
  invitationSessionStatus,
  recordInvitationProof,
} from '@/features/employees/invitation-acceptance-data';

// Issue #69: the delivered invite link lands here with the invite session in its fragment.
// The client reads the fragment and posts it; this establishes the session from the exact
// delivered tokens. Only that path records the one-time invite-flow proof, so the accept step
// (and this revisit read) can prove the session came from the invitation rather than a
// password-recovery or ordinary sign-in session. Neither the token nor the identity is logged
// or cached.
export function POST(request: NextRequest) {
  return runRoute(request, async (context) => {
    const body = await objectBody(request, context, 8192, true);
    const session = await establishInvitationSession(context, body);
    const status = await invitationSessionStatus(context);
    if (status.status === 'setup') {
      if (session.kind === 'tokens')
        await recordInvitationProof(context, status.setup, session.user.id);
      else if (
        !(await invitationProofValid(context, status.setup, session.user.id))
      )
        throw new ApiError(409, 'invitation-session-required');
    }
    return NextResponse.json(status);
  });
}
