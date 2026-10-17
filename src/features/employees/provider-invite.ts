import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  invitationDestination,
  providerIdentityScan,
  providerInviteResult,
  type InvitationSender,
  type ProviderIdentity,
} from './invitation';

// The Admin API lists identities page by page instead of looking one address up, so the refused
// retry reads a bounded number of pages. The page size is the provider's own documented default,
// so no response can be capped below it, and only a page shorter than it proves the list ended.
const IDENTITY_PAGE_SIZE = 50;
const IDENTITY_PAGE_LIMIT = 20;

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
    // Issue #68 follow-up: the address the provider just refused may already hold an identity,
    // because an accepted invitation whose recording was lost had already created it. The
    // identity is matched on exactly the recorded normalized address, and only an exhausted
    // list may answer `absent`.
    async identity(email): Promise<ProviderIdentity> {
      return providerIdentityScan(
        email,
        IDENTITY_PAGE_SIZE,
        IDENTITY_PAGE_LIMIT,
        async (page, pageSize) => {
          const { data, error } = await admin.auth.admin.listUsers({
            page,
            perPage: pageSize,
          });
          if (error) throw new Error(error.message);
          return data?.users;
        },
      );
    },
  };
}
