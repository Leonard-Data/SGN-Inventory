import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Environment } from '@/lib/environment';
import type { Database } from '@/types/database';
import { providerServiceKey } from '@/features/employees/deactivation';

// The one server-only service-role client. The secret is read from server configuration only,
// is never exposed through a NEXT_PUBLIC_ variable, and every caller uses it for the narrow
// trusted operation that needs to bypass the request session: a missing or placeholder secret
// returns null so the operation fails closed instead of running with the wrong authority.
export function createServiceRoleClient(
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
