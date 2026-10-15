import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  invitationDestination,
  providerInviteResult,
  type InvitationSender,
} from './invitation';

// Issue #68: the server-only invitation boundary. The Auth admin call needs a secret/
// service-role key; it is read from server configuration only, never exposed through a
// NEXT_PUBLIC_ variable, and this adapter sends exactly one invitation to the recorded
// address with the fixed application destination. No role, name or other company data is
// written into the provider's editable user metadata, and the caller's own address cannot
// move the destination.
export function supabaseInvitationSender(
  admin: SupabaseClient<Database>,
  appUrl: string,
): InvitationSender {
  return {
    async send(request) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(
        request.email,
        { redirectTo: invitationDestination(appUrl) },
      );
      return providerInviteResult(
        {
          user: data?.user
            ? { id: data.user.id, email: data.user.email }
            : null,
          error: error
            ? { status: error.status ?? 0, message: error.message }
            : null,
        },
        request.email,
      );
    },
  };
}
