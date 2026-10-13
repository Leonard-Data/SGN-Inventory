import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Environment } from '@/lib/environment';
import type { Database } from '@/types/database';
import {
  SIGN_IN_BLOCK_BAN_DURATION,
  providerBanResult,
  providerDetail,
  providerServiceKey,
  type SignInBlocker,
} from './deactivation';

// Issue #66: the server-only sign-in blocker boundary. The Admin Auth call needs a
// secret/service-role key; that key is read from server configuration only, is never
// exposed through a NEXT_PUBLIC_ variable and this client is used for nothing except the
// exact employee's Auth admin call and the guarded provider-result RPC.
export function createEmployeeAdminClient(
  environment: Environment,
  values: Readonly<Record<string, string | undefined>> = process.env,
): SupabaseClient<Database> | null {
  const key = providerServiceKey(values);
  if (!key) return null;
  return createClient<Database>(environment.supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}

// Every outcome is a value, never an exception: a transport or provider failure is recorded
// as failed/ambiguous and can never be read as a confirmed block. The requested duration is
// bounded and the provider's own banned_until is the confirmed expiry.
export function supabaseSignInBlocker(
  admin: SupabaseClient<Database>,
): SignInBlocker {
  return {
    async block(request) {
      try {
        const { data, error } = await admin.auth.admin.updateUserById(
          request.authUserId,
          { ban_duration: SIGN_IN_BLOCK_BAN_DURATION },
        );
        return providerBanResult({
          user: data?.user ?? null,
          error: error
            ? { status: error.status ?? 0, message: error.message }
            : null,
        });
      } catch (failure) {
        return { outcome: 'ambiguous', detail: providerDetail(failure) };
      }
    },
  };
}
