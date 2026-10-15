import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';
import {
  accountDeletionResult,
  accountPresence,
  parseStoragePreflight,
  parseStorageReassignment,
  type AccountDeletionProvider,
} from './deletion';
import { providerDetail } from './deactivation';

// Issue #67: the server-only provider boundary for permanent account deletion. Deletion and
// Storage ownership both need the secret/service-role key; that key is read from server
// configuration only, is never exposed through a NEXT_PUBLIC_ variable and this client is
// used for nothing except the exact employee's Auth account and the guarded Storage RPCs.
//
// Supabase refuses to delete an Auth user that still owns Storage objects and the pinned
// client has no ownership-transfer call, so ownership is moved through the guarded
// `reassign_employee_storage_ownership` RPC, which changes only the ownership columns and
// leaves every object id, path, metadata byte and uploader attribution untouched. A failure
// or an unavailable mechanism is returned as a value and recorded as a truthful partial
// state; no document is ever deleted, retargeted or anonymized to make the delete succeed.
export function supabaseAccountDeletionProvider(
  admin: SupabaseClient<Database>,
): AccountDeletionProvider {
  return {
    async preflight(authUserId) {
      const { data, error } = await admin.rpc('employee_storage_preflight', {
        p_auth_user_id: authUserId,
      });
      if (error) throw new Error(error.message);
      const preflight = parseStoragePreflight(data);
      if (!preflight)
        throw new Error('storage preflight returned an unexpected shape');
      return preflight;
    },
    async reassignStorageOwnership(fromAuthUserId, toAuthUserId) {
      const { data, error } = await admin.rpc(
        'reassign_employee_storage_ownership',
        {
          p_from_auth_user_id: fromAuthUserId,
          p_to_auth_user_id: toAuthUserId,
        },
      );
      if (error) throw new Error(error.message);
      const moved = parseStorageReassignment(data);
      if (!moved)
        throw new Error('storage reassignment returned an unexpected shape');
      return moved;
    },
    async deleteAccount(authUserId) {
      try {
        const { data, error } = await admin.auth.admin.deleteUser(authUserId);
        return accountDeletionResult({
          user: data?.user ?? null,
          error: error
            ? { status: error.status ?? 0, message: error.message }
            : null,
        });
      } catch (failure) {
        return { outcome: 'ambiguous', detail: providerDetail(failure) };
      }
    },
    async accountPresence(authUserId) {
      try {
        const { data, error } = await admin.auth.admin.getUserById(authUserId);
        return accountPresence({
          user: data?.user ?? null,
          error: error ? { status: error.status } : null,
        });
      } catch {
        return 'unknown';
      }
    },
  };
}
