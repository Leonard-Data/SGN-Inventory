// The upload window and its cleanup. The signed upload URL lives 60 seconds, so a
// registration still pending after 15 minutes can no longer receive bytes; the storage-limits
// migration applies the same window to its class-slot count.
export const pendingUploadMs = 15 * 60_000;

export type CleanupStore = {
  remove: (objectPath: string) => Promise<void>;
  log: (message: string) => void;
};

export function expiredPendingRegistration(
  file: { upload_status: string; created_at: string },
  now: number,
): boolean {
  return (
    file.upload_status === 'pending' &&
    Date.parse(file.created_at) <= now - pendingUploadMs
  );
}

// 'absent' only once the bytes are really gone: a failed removal stays 'unknown' so an outage
// is never read as permission to upload over bytes that may still exist.
export async function discardExpiredRegistration(
  store: CleanupStore,
  objectPath: string,
): Promise<'absent' | 'unknown'> {
  try {
    await store.remove(objectPath);
    return 'absent';
  } catch (error) {
    store.log(
      `could not discard expired upload ${objectPath}: ${String(error)}`,
    );
    return 'unknown';
  }
}

// Deletes a released registration's bytes, then records that they are gone. A failed removal
// leaves the row eligible for cleanup, so the next sweep retries it.
export async function sweepReleasedBytes(
  store: CleanupStore,
  objectPath: string,
  confirmCleaned: () => Promise<void>,
): Promise<boolean> {
  try {
    await store.remove(objectPath);
  } catch (error) {
    store.log(
      `could not remove ${objectPath}; the next sweep retries: ${String(error)}`,
    );
    return false;
  }
  try {
    await confirmCleaned();
  } catch (error) {
    store.log(
      `could not record cleaned upload ${objectPath}: ${String(error)}`,
    );
    return false;
  }
  return true;
}

// A refused completion releases its class slot at once and discards its bytes. Only a confirmed
// removal moves the row to 'failed', and only when the release actually moved the pending row:
// a release that matched nothing means the file is no longer this upload's to delete.
export async function discardRefusedCompletion(
  deps: CleanupStore & {
    pendingOwnerPath: () => Promise<string | null>;
    releaseSlot: () => Promise<boolean>;
    confirmCleaned: () => Promise<void>;
  },
): Promise<void> {
  const objectPath = await deps.pendingOwnerPath();
  if (!objectPath) return;
  let released: boolean;
  try {
    released = await deps.releaseSlot();
  } catch (error) {
    deps.log(
      `could not release refused upload ${objectPath}: ${String(error)}`,
    );
    return;
  }
  if (!released) return;
  await sweepReleasedBytes(deps, objectPath, deps.confirmCleaned);
}

// A request must never become a long job, so every run handles a bounded batch: ordinary
// traffic drains a few, and the operator run takes the whole backlog in one batch.
export const opportunisticCleanupLimit = 3;
export const operatorCleanupLimit = 20;

export type CleanupSummary = {
  retried: number;
  cleared: number;
  remaining: number | null;
};

export type CleanupSource = {
  pending: (limit: number) => Promise<{ id: string; objectPath: string }[]>;
  remaining: () => Promise<number | null>;
};

export type CleanupWriter = CleanupStore & {
  markCleaned: (fileId: string) => Promise<void>;
};

// One pass over the released registrations of every property and every uploader: each row's
// bytes are deleted first, and only a confirmed deletion lets the row become 'failed'.
export async function runFileCleanup(
  source: CleanupSource,
  writer: CleanupWriter,
  limit: number,
): Promise<CleanupSummary> {
  let pending: { id: string; objectPath: string }[] = [];
  try {
    pending = await source.pending(limit);
  } catch (error) {
    writer.log(
      `file cleanup could not list released uploads: ${String(error)}`,
    );
  }
  let cleared = 0;
  for (const row of pending)
    if (
      await sweepReleasedBytes(writer, row.objectPath, () =>
        writer.markCleaned(row.id),
      )
    )
      cleared++;
  let remaining: number | null = null;
  try {
    remaining = await source.remaining();
  } catch (error) {
    writer.log(
      `file cleanup could not count remaining uploads: ${String(error)}`,
    );
  }
  if (pending.length || remaining)
    writer.log(
      `file cleanup: retried ${pending.length}, cleared ${cleared}, remaining ${remaining ?? 'unknown'}`,
    );
  return { retried: pending.length, cleared, remaining };
}
