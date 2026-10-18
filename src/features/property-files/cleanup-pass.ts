import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Environment } from '@/lib/environment';
import { createServiceRoleClient } from '@/lib/supabase/service';
import type { Database } from '@/types/database';
import { deleteObject } from '@/lib/r2';
import {
  opportunisticCleanupLimit,
  runFileCleanup,
  type CleanupSource,
  type CleanupSummary,
  type CleanupWriter,
} from './upload-cleanup';

export function supabaseFileCleanup(admin: SupabaseClient<Database>): {
  source: CleanupSource;
  writer: CleanupWriter;
} {
  return {
    source: {
      pending: async (limit) => {
        const { data, error } = await admin
          .from('property_files')
          .select('id,object_path')
          .eq('upload_status', 'cleanup_pending')
          .order('id')
          .limit(limit);
        if (error) throw error;
        return (data ?? []).map((row) => ({
          id: row.id,
          objectPath: row.object_path,
        }));
      },
      remaining: async () => {
        const { count, error } = await admin
          .from('property_files')
          .select('id', { count: 'exact', head: true })
          .eq('upload_status', 'cleanup_pending');
        if (error) throw error;
        return count ?? null;
      },
    },
    writer: {
      remove: deleteObject,
      log: (message) => console.error(message),
      markCleaned: async (fileId) => {
        const { error } = await admin.rpc('mark_upload_cleaned', {
          p_file_id: fileId,
        });
        if (error) throw error;
      },
    },
  };
}

let warnedUnconfigured = false;

// Never throws: a completion request or an operator call reports the summary it managed, and a
// missing secret or a store failure stays a logged, retried backlog instead of a failed request.
export async function drainFileCleanup(
  environment: Environment,
  limit = opportunisticCleanupLimit,
): Promise<CleanupSummary | null> {
  try {
    const admin = createServiceRoleClient(environment);
    if (!admin) {
      if (!warnedUnconfigured) {
        warnedUnconfigured = true;
        console.error(
          'file cleanup is not configured: SUPABASE_SERVICE_ROLE_KEY is required',
        );
      }
      return null;
    }
    const { source, writer } = supabaseFileCleanup(admin);
    return await runFileCleanup(source, writer, limit);
  } catch (error) {
    console.error(`file cleanup failed: ${String(error)}`);
    return null;
  }
}
